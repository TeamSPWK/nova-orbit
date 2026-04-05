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

    // Build org context so the agent knows the team structure
    const projectAgents = db.prepare("SELECT id, name, role, parent_id FROM agents WHERE project_id = ?").all(agent.project_id) as any[];
    let orgContext = "";
    if (projectAgents.length > 1) {
      const parent = projectAgents.find((a: any) => a.id === agent.parent_id);
      const subordinates = projectAgents.filter((a: any) => a.parent_id === agentId);
      const peers = agent.parent_id
        ? projectAgents.filter((a: any) => a.parent_id === agent.parent_id && a.id !== agentId)
        : [];

      const lines: string[] = [`[Org Context] You are "${agent.name}" (${agent.role}).`];
      if (parent) lines.push(`You report to "${parent.name}" (${parent.role}).`);
      if (subordinates.length > 0) {
        lines.push(`Your team: ${subordinates.map((s: any) => `${s.name}(${s.role})`).join(", ")}.`);
      }
      if (peers.length > 0) {
        lines.push(`Peers: ${peers.map((p: any) => `${p.name}(${p.role})`).join(", ")}.`);
      }
      orgContext = lines.join(" ") + "\n\n";
    }

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

        const result = await session.send(orgContext + message.trim());

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

  // Send a prompt to multiple agents sequentially
  router.post("/multi-prompt", async (req, res) => {
    const { agentIds, message, projectId } = req.body ?? {};

    if (!Array.isArray(agentIds) || agentIds.length < 2) {
      return res.status(400).json({ error: "agentIds must be an array of at least 2" });
    }
    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({ error: "message is required" });
    }
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Validate all agents exist and are not working
    const agentList: any[] = [];
    for (const agentId of agentIds) {
      const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as any;
      if (!agent) return res.status(404).json({ error: `Agent ${agentId} not found` });
      if (agent.status === "working") {
        return res.status(409).json({ error: `Agent "${agent.name}" is already working` });
      }
      agentList.push(agent);
    }

    const sessionId = `multi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Return immediately — run asynchronously
    res.json({ status: "started", sessionId });

    (async () => {
      const workdir = project.workdir || process.cwd();
      const results: { agentId: string; agentName: string; result: string }[] = [];

      for (let i = 0; i < agentList.length; i++) {
        const agent = agentList[i];

        // Build prompt with previous context
        let prompt: string;
        if (i === 0) {
          prompt = message.trim();
        } else {
          const discussionLines = results
            .map((r) => {
              const prevAgent = agentList.find((a) => a.id === r.agentId)!;
              return `### ${r.agentName} (${prevAgent.role})의 의견:\n${r.result}`;
            })
            .join("\n\n---\n\n");

          prompt = `## 이전 논의\n\n${discussionLines}\n\n---\n\n## 당신의 차례\n\n위 논의를 참고하여 다음 질문에 답해주세요:\n${message.trim()}`;
        }

        // Mark agent as working
        db.prepare("UPDATE agents SET status = 'working' WHERE id = ?").run(agent.id);
        broadcast("agent:status", { id: agent.id, name: agent.name, status: "working" });

        let agentResult = "";
        let session: any;
        try {
          session = sessionManager.spawnAgent(agent.id, workdir);

          session.on("output", (text: string) => {
            broadcast("agent:output", { agentId: agent.id, output: text });
          });

          const execResult = await session.send(prompt);

          const { parseStreamJson } = await import("../../core/agent/adapters/stream-parser.js");
          const parsed = parseStreamJson(execResult.stdout);
          agentResult = parsed.text;
        } catch (err: any) {
          agentResult = `[Error: ${err.message}]`;
        } finally {
          db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").run(agent.id);
          broadcast("agent:status", { id: agent.id, name: agent.name, status: "idle" });
        }

        results.push({ agentId: agent.id, agentName: agent.name, result: agentResult });
        broadcast("multi-prompt:agent-done", {
          sessionId,
          agentId: agent.id,
          agentName: agent.name,
          result: agentResult,
          index: i,
          total: agentList.length,
        });
      }

      // If the last agent is CTO, try to auto-create goal + tasks
      let autoCreated = false;
      const lastAgent = agentList[agentList.length - 1];
      if (lastAgent.role === "cto") {
        try {
          const lastResult = results[results.length - 1].result;
          const jsonMatch = lastResult.match(/```json\s*([\s\S]*?)\s*```/) ??
                            lastResult.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
          if (jsonMatch) {
            const jsonStr = jsonMatch[1] ?? jsonMatch[0];
            const data = JSON.parse(jsonStr);
            const tasks = data.tasks ?? [];
            if (tasks.length > 0) {
              const goalDesc = data.goal ?? data.analysis ?? message.trim().slice(0, 200);
              const goalResult = db.prepare(
                "INSERT INTO goals (project_id, description, priority) VALUES (?, ?, 'high')",
              ).run(project.id, goalDesc);
              const goalId = (db.prepare("SELECT id FROM goals WHERE rowid = ?").get(goalResult.lastInsertRowid) as any)?.id;

              if (goalId) {
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
                ).run(project.id, lastAgent.id, `CTO created goal "${goalDesc.slice(0, 50)}" with ${tasks.length} tasks (multi-prompt)`);
              }
            }
          }
        } catch {
          // JSON parsing failed — show text result only
        }
      }

      if (!autoCreated) {
        db.prepare(
          "INSERT INTO activities (project_id, type, message) VALUES (?, 'task_completed', ?)",
        ).run(project.id, `Multi-prompt completed (${agentList.length} agents)`);
      }

      broadcast("multi-prompt:complete", {
        sessionId,
        results,
        autoCreated,
      });
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

  // Check queue status for a project (extended with pause info)
  router.get("/projects/:projectId/queue-status", (req, res) => {
    const { projectId } = req.params;
    const state = scheduler.getQueueState(projectId);
    res.json({ ...state, projectId });
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

  // Resume a paused queue (manual resume after rate limit)
  router.post("/projects/:projectId/resume-queue", (req, res) => {
    const { projectId } = req.params;

    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId) as any;
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (!scheduler.isPaused(projectId)) {
      return res.status(400).json({ error: "Queue is not paused" });
    }

    scheduler.resumeQueue(projectId);
    res.json({ status: "queue_resumed", projectId });
  });

  // Expose engine & scheduler on ctx for autopilot triggers in goals.ts / projects.ts
  ctx.orchestrationEngine = engine;
  ctx.scheduler = scheduler;

  return router;
}
