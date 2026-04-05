import { Router } from "express";
import type { AppContext } from "../../index.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("goals");

export function createGoalRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  // List goals by project
  router.get("/", (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    if (!projectId) return res.status(400).json({ error: "projectId query param required" });

    const goals = db.prepare(
      "SELECT * FROM goals WHERE project_id = ? ORDER BY priority, created_at",
    ).all(projectId);
    res.json(goals);
  });

  // Create goal — triggers autopilot if enabled
  router.post("/", (req, res) => {
    const { project_id, description, priority = "medium" } = req.body;
    if (!project_id || !description) {
      return res.status(400).json({ error: "project_id and description are required" });
    }

    const VALID_PRIORITIES = ["critical", "high", "medium", "low"];
    if (!VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` });
    }

    try {
      const result = db.prepare(
        "INSERT INTO goals (project_id, description, priority) VALUES (?, ?, ?)",
      ).run(project_id, description, priority);

      const goal = db.prepare("SELECT * FROM goals WHERE rowid = ?").get(result.lastInsertRowid) as any;
      broadcast("project:updated", { projectId: project_id });
      res.status(201).json(goal);

      // --- Autopilot trigger (async, after response) ---
      const project = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(project_id) as { autopilot: string } | undefined;
      if (project && (project.autopilot === "goal" || project.autopilot === "full")) {
        triggerAutopilotDecompose(goal.id, project_id);
      }
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update goal progress
  router.patch("/:id", (req, res) => {
    const { description, priority, progress } = req.body;
    const existing = db.prepare("SELECT * FROM goals WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Goal not found" });

    try {
      db.prepare(`
        UPDATE goals SET
          description = COALESCE(?, description),
          priority = COALESCE(?, priority),
          progress = COALESCE(?, progress)
        WHERE id = ?
      `).run(description ?? null, priority ?? null, progress ?? null, req.params.id);

      const updated = db.prepare("SELECT * FROM goals WHERE id = ?").get(req.params.id);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete goal
  router.delete("/:id", (req, res) => {
    const result = db.prepare("DELETE FROM goals WHERE id = ?").run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Goal not found" });
    res.json({ success: true });
  });

  // --- Internal: autopilot decompose + queue start ---
  async function triggerAutopilotDecompose(goalId: string, projectId: string) {
    // Guard: ensure engine and scheduler are available (lazy import from ctx)
    if (!ctx.orchestrationEngine || !ctx.scheduler) {
      log.warn("Autopilot trigger skipped: orchestration not initialized yet");
      return;
    }

    try {
      log.info(`Autopilot: auto-decomposing goal ${goalId}`);

      // Check that goal doesn't already have tasks (race condition guard)
      const existing = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE goal_id = ?").get(goalId) as { count: number };
      if (existing.count > 0) {
        log.warn(`Autopilot: goal ${goalId} already has tasks, skipping decompose`);
        return;
      }

      const result = await ctx.orchestrationEngine.decomposeGoal(goalId);

      if (result.taskCount > 0) {
        // Autopilot: auto-approve tasks so scheduler can pick them up immediately
        const approved = db.prepare(
          "UPDATE tasks SET status = 'todo' WHERE goal_id = ? AND status = 'pending_approval'"
        ).run(goalId);
        log.info(`Autopilot: auto-approved ${approved.changes} tasks for goal ${goalId}`);

        // Auto-start queue if not already running
        if (!ctx.scheduler.isRunning(projectId)) {
          log.info(`Autopilot: auto-starting queue for project ${projectId}`);
          ctx.scheduler.startQueue(projectId);
        }
      }

      db.prepare(
        "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot', ?)",
      ).run(projectId, `Autopilot decomposed goal into ${result.taskCount} tasks`);
    } catch (err: any) {
      log.error(`Autopilot decompose failed for goal ${goalId}`, err);
      db.prepare(
        "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_error', ?)",
      ).run(projectId, `Autopilot failed: ${err.message?.slice(0, 200)}`);
    }
  }

  return router;
}
