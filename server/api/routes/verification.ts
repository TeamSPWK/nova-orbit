import { Router } from "express";
import type { AppContext } from "../../index.js";

export function createVerificationRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  // List verifications for a task
  router.get("/", (req, res) => {
    const { taskId, projectId } = req.query;

    let verifications;
    if (taskId) {
      verifications = db.prepare(
        "SELECT * FROM verifications WHERE task_id = ? ORDER BY created_at DESC",
      ).all(taskId);
    } else if (projectId) {
      verifications = db.prepare(`
        SELECT v.* FROM verifications v
        JOIN tasks t ON v.task_id = t.id
        WHERE t.project_id = ?
        ORDER BY v.created_at DESC
      `).all(projectId);
    } else {
      return res.status(400).json({ error: "taskId or projectId query param required" });
    }

    // Parse JSON fields
    const parsed = (verifications as any[]).map((v) => ({
      ...v,
      dimensions: JSON.parse(v.dimensions),
      issues: JSON.parse(v.issues),
    }));

    res.json(parsed);
  });

  // Create verification result
  router.post("/", (req, res) => {
    const { task_id, verdict, scope = "standard", dimensions, issues = [], severity, evaluator_session_id } = req.body;

    if (!task_id || !verdict) {
      return res.status(400).json({ error: "task_id and verdict are required" });
    }

    const result = db.prepare(`
      INSERT INTO verifications (task_id, verdict, scope, dimensions, issues, severity, evaluator_session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      task_id,
      verdict,
      scope,
      JSON.stringify(dimensions ?? {}),
      JSON.stringify(issues),
      severity ?? "auto-resolve",
      evaluator_session_id ?? null,
    );

    const verification = db.prepare("SELECT * FROM verifications WHERE rowid = ?").get(result.lastInsertRowid) as any;

    // Update task with verification result
    db.prepare("UPDATE tasks SET verification_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(verification.id, task_id);

    // If hard-block, set task to blocked
    if (severity === "hard-block") {
      db.prepare("UPDATE tasks SET status = 'blocked', updated_at = datetime('now') WHERE id = ?")
        .run(task_id);
    }

    // Log activity
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task_id) as any;
    if (task) {
      db.prepare(`
        INSERT INTO activities (project_id, type, message, metadata)
        VALUES (?, ?, ?, ?)
      `).run(
        task.project_id,
        verdict === "pass" ? "verification_pass" : "verification_fail",
        `Task "${task.title}" verification: ${verdict.toUpperCase()}`,
        JSON.stringify({ taskId: task_id, verdict, severity }),
      );
    }

    broadcast("verification:result", {
      ...verification,
      dimensions: JSON.parse(verification.dimensions),
      issues: JSON.parse(verification.issues),
    });

    res.status(201).json({
      ...verification,
      dimensions: JSON.parse(verification.dimensions),
      issues: JSON.parse(verification.issues),
    });
  });

  return router;
}
