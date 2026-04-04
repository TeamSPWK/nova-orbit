import { Router } from "express";
import type { AppContext } from "../../index.js";
import { createSessionManager } from "../../core/agent/session.js";
import { createOrchestrationEngine } from "../../core/orchestration/engine.js";
import { createScheduler } from "../../core/orchestration/scheduler.js";
import { createQualityGate } from "../../core/quality-gate/evaluator.js";

export function createOrchestrationRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  const sessionManager = createSessionManager(db);
  const engine = createOrchestrationEngine(db, sessionManager, broadcast);
  const scheduler = createScheduler(db, sessionManager, broadcast);
  const qualityGate = createQualityGate(db, sessionManager);

  // Expose sessionManager on ctx so other routes (e.g. agent delete) can kill sessions
  ctx.sessionManager = sessionManager;

  // Execute a single task
  router.post("/tasks/:taskId/execute", async (req, res) => {
    const { taskId } = req.params;
    const { verificationScope = "standard" } = req.body ?? {};

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!task.assignee_id) return res.status(400).json({ error: "Task has no assigned agent" });

    // Prevent duplicate execution — atomic status transition
    if (task.status === "in_progress") {
      return res.status(409).json({ error: "Task is already in progress" });
    }
    if (task.status === "done") {
      return res.status(400).json({ error: "Task is already done" });
    }

    // Start execution asynchronously, return immediately
    res.json({ status: "started", taskId });

    try {
      const result = await engine.executeTask(taskId, { verificationScope });
      broadcast("task:updated", { taskId, ...result });
    } catch (err: any) {
      broadcast("task:updated", {
        taskId,
        status: "blocked",
        error: err.message,
      });
    }
  });

  // Decompose a goal into tasks (waits for completion)
  router.post("/goals/:goalId/decompose", async (req, res) => {
    const { goalId } = req.params;

    const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as any;
    if (!goal) return res.status(404).json({ error: "Goal not found" });

    // Prevent duplicate decomposition
    const existingTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE goal_id = ?").get(goalId) as any;
    if (existingTasks.count > 0) {
      return res.status(409).json({ error: "Goal already has tasks. Delete existing tasks first to re-decompose." });
    }

    try {
      await engine.decomposeGoal(goalId);
      broadcast("project:updated", { projectId: goal.project_id });

      const tasks = db.prepare("SELECT * FROM tasks WHERE goal_id = ?").all(goalId);
      res.json({ status: "completed", goalId, taskCount: tasks.length });
    } catch (err: any) {
      broadcast("project:updated", { projectId: goal.project_id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Verify a task (Quality Gate only, no execution)
  // If verdict is pass, auto-approves the task to done
  router.post("/tasks/:taskId/verify", async (req, res) => {
    const { taskId } = req.params;
    const { scope = "standard" } = req.body ?? {};

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
    if (!task) return res.status(404).json({ error: "Task not found" });

    // Return immediately, run verification asynchronously
    res.json({ status: "verifying", taskId });

    try {
      const result = await qualityGate.verify(taskId, { scope });
      broadcast("verification:result", result);

      // Link verification to task
      const verification = db.prepare(
        "SELECT id FROM verifications WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
      ).get(taskId) as any;

      if (verification) {
        db.prepare("UPDATE tasks SET verification_id = ?, updated_at = datetime('now') WHERE id = ?")
          .run(verification.id, taskId);
      }

      // Auto-approve on pass
      if (result.verdict === "pass") {
        db.prepare("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?")
          .run(taskId);

        const goalRow = db.prepare("SELECT goal_id FROM tasks WHERE id = ?").get(taskId) as any;
        if (goalRow?.goal_id) {
          const stats = db.prepare(`
            SELECT COUNT(*) as total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
            FROM tasks WHERE goal_id = ?
          `).get(goalRow.goal_id) as { total: number; done: number };
          const progress = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
          db.prepare("UPDATE goals SET progress = ? WHERE id = ?").run(progress, goalRow.goal_id);
        }

        db.prepare(
          "INSERT INTO activities (project_id, type, message) VALUES (?, 'task_approved', ?)",
        ).run(task.project_id, `Verified & approved: ${task.title}`);
      }

      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
      broadcast("task:updated", updated);
    } catch (err: any) {
      // Read actual DB state — evaluator may have set it to 'blocked'
      const currentTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
      broadcast("task:updated", currentTask ?? { taskId, status: "in_review", error: err.message });
    }
  });

  // Send a direct prompt to an agent
  router.post("/agents/:agentId/prompt", async (req, res) => {
    const { agentId } = req.params;
    const { message } = req.body ?? {};

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({ error: "message is required" });
    }

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as any;
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    if (agent.status === "working") {
      return res.status(409).json({ error: "Agent is already working" });
    }

    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(agent.project_id) as any;
    if (!project) return res.status(404).json({ error: "Project not found" });

    const workdir = project.workdir || process.cwd();

    // Return immediately — run asynchronously
    res.json({ status: "started", agentId });

    (async () => {
      // Update agent status to working
      db.prepare("UPDATE agents SET status = 'working' WHERE id = ?").run(agentId);
      broadcast("agent:status", { id: agentId, name: agent.name, status: "working" });

      let session;
      try {
        session = sessionManager.spawnAgent(agentId, workdir);

        // Stream output to WebSocket
        session.on("output", (text: string) => {
          broadcast("agent:output", { agentId, output: text });
        });

        const result = await session.send(message.trim());

        // Parse result text for broadcast
        const { parseStreamJson } = await import("../../core/agent/adapters/stream-parser.js");
        const parsed = parseStreamJson(result.stdout);

        // If CTO agent: try to extract goal + tasks from response and auto-create
        let autoCreated = false;
        if (agent.role === "cto") {
          try {
            const jsonMatch = parsed.text.match(/```json\s*([\s\S]*?)\s*```/) ??
                              parsed.text.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
            if (jsonMatch) {
              const jsonStr = jsonMatch[1] ?? jsonMatch[0];
              const data = JSON.parse(jsonStr);
              const tasks = data.tasks ?? [];
              if (tasks.length > 0) {
                // Create goal from CTO's analysis
                const goalDesc = data.goal ?? data.analysis ?? message.trim().slice(0, 200);
                const goalResult = db.prepare(
                  "INSERT INTO goals (project_id, description, priority) VALUES (?, ?, 'high')",
                ).run(project.id, goalDesc);
                const goalId = (db.prepare("SELECT id FROM goals WHERE rowid = ?").get(goalResult.lastInsertRowid) as any)?.id;

                if (goalId) {
                  // Get project agents for role matching
                  const projectAgents = db.prepare("SELECT * FROM agents WHERE project_id = ?").all(project.id) as any[];
                  const ctoAgent = projectAgents.find((a: any) => a.role === "cto");
                  const candidates = ctoAgent
                    ? projectAgents.filter((a: any) => a.parent_id === ctoAgent.id)
                    : projectAgents.filter((a: any) => a.role !== "cto");

                  const findAgentForRole = (role: string) =>
                    candidates.find((a: any) => a.role === role) ??
                    candidates.find((a: any) => a.role === "coder") ??
                    candidates[0] ?? null;

                  for (const t of tasks) {
                    if (!t.title || typeof t.title !== "string") continue;
                    const assignee = findAgentForRole(t.role ?? "coder");
                    db.prepare(
                      "INSERT INTO tasks (goal_id, project_id, title, description, assignee_id) VALUES (?, ?, ?, ?, ?)",
                    ).run(goalId, project.id, t.title.slice(0, 200), (t.description ?? "").slice(0, 2000), assignee?.id ?? null);
                  }

                  autoCreated = true;
                  broadcast("project:updated", { projectId: project.id });

                  db.prepare(
                    "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'task_completed', ?)",
                  ).run(project.id, agentId, `CTO created goal "${goalDesc.slice(0, 50)}" with ${tasks.length} tasks`);
                }
              }
            }
          } catch {
            // JSON parsing failed — just show text result
          }
        }

        broadcast("agent:prompt-complete", {
          agentId,
          result: parsed.text,
          exitCode: result.exitCode,
          autoCreated,
        });

        if (!autoCreated) {
          db.prepare(
            "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'task_completed', ?)",
          ).run(project.id, agentId, `Direct prompt completed`);
        }
      } catch (err: any) {
        broadcast("agent:prompt-complete", {
          agentId,
          result: null,
          error: err.message,
        });
      } finally {
        db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").run(agentId);
        broadcast("agent:status", { id: agentId, name: agent.name, status: "idle" });
      }
    })();
  });

  // Kill an agent session
  router.post("/agents/:agentId/kill", (req, res) => {
    const { agentId } = req.params;
    sessionManager.killSession(agentId);
    res.json({ status: "killed", agentId });
  });

  // Kill all sessions
  router.post("/sessions/kill-all", (_req, res) => {
    sessionManager.killAll();
    res.json({ status: "all_killed" });
  });

  // Pause an agent session
  router.post("/agents/:agentId/pause", (req, res) => {
    const { agentId } = req.params;
    try {
      sessionManager.pauseSession(agentId);
      broadcast("agent:status", { id: agentId, status: "paused" });
      res.json({ status: "paused", agentId });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Resume a paused agent session
  router.post("/agents/:agentId/resume", (req, res) => {
    const { agentId } = req.params;
    try {
      sessionManager.resumeSession(agentId);
      broadcast("agent:status", { id: agentId, status: "working" });
      res.json({ status: "resumed", agentId });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Check queue status for a project
  router.get("/projects/:projectId/queue-status", (req, res) => {
    const { projectId } = req.params;
    res.json({ running: scheduler.isRunning(projectId), projectId });
  });

  // Start priority queue for a project
  router.post("/projects/:projectId/run-queue", (req, res) => {
    const { projectId } = req.params;

    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId) as any;
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (scheduler.isRunning(projectId)) {
      return res.status(409).json({ error: "Queue already running for this project" });
    }

    scheduler.startQueue(projectId);
    res.json({ status: "queue_started", projectId });
  });

  // Stop priority queue for a project
  router.post("/projects/:projectId/stop-queue", (req, res) => {
    const { projectId } = req.params;

    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId) as any;
    if (!project) return res.status(404).json({ error: "Project not found" });

    scheduler.stopQueue(projectId);
    res.json({ status: "queue_stopped", projectId });
  });

  return router;
}
