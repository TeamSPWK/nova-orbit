import { Router } from "express";
import type { AppContext } from "../../index.js";
import { createSessionManager } from "../../core/agent/session.js";
import { createOrchestrationEngine } from "../../core/orchestration/engine.js";
import { createScheduler } from "../../core/orchestration/scheduler.js";

export function createOrchestrationRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  const sessionManager = createSessionManager(db);
  const engine = createOrchestrationEngine(db, sessionManager, broadcast);
  const scheduler = createScheduler(db, sessionManager, broadcast);

  // Execute a single task
  router.post("/tasks/:taskId/execute", async (req, res) => {
    const { taskId } = req.params;
    const { verificationScope = "standard" } = req.body ?? {};

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!task.assignee_id) return res.status(400).json({ error: "Task has no assigned agent" });

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
