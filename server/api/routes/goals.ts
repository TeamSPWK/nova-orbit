import { Router } from "express";
import type { AppContext } from "../../index.js";

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

  // Create goal
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

      const goal = db.prepare("SELECT * FROM goals WHERE rowid = ?").get(result.lastInsertRowid);
      broadcast("project:updated", { projectId: project_id });
      res.status(201).json(goal);
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

  return router;
}
