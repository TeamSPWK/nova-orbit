import { Router } from "express";
import type { AppContext } from "../../index.js";
import { createSessionManager } from "../../core/agent/session.js";
import { createOrchestrationEngine } from "../../core/orchestration/engine.js";

export function createOrchestrationRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  const sessionManager = createSessionManager(db);
  const engine = createOrchestrationEngine(db, sessionManager, broadcast);

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

  // Decompose a goal into tasks
  router.post("/goals/:goalId/decompose", async (req, res) => {
    const { goalId } = req.params;

    const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as any;
    if (!goal) return res.status(404).json({ error: "Goal not found" });

    res.json({ status: "started", goalId });

    try {
      await engine.decomposeGoal(goalId);
      broadcast("project:updated", { projectId: goal.project_id });
    } catch (err: any) {
      broadcast("project:updated", {
        projectId: goal.project_id,
        error: err.message,
      });
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

  return router;
}
