import { Router } from "express";
import type { AppContext } from "../../index.js";

export function createTaskRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  // List tasks (filter by projectId or goalId)
  router.get("/", (req, res) => {
    const { projectId, goalId } = req.query;

    let tasks;
    if (goalId) {
      tasks = db.prepare("SELECT * FROM tasks WHERE goal_id = ? ORDER BY created_at").all(goalId);
    } else if (projectId) {
      tasks = db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY status, created_at").all(projectId);
    } else {
      return res.status(400).json({ error: "projectId or goalId query param required" });
    }
    res.json(tasks);
  });

  // Get single task
  router.get("/:id", (req, res) => {
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  });

  // Create task
  router.post("/", (req, res) => {
    const { goal_id, project_id, title, description = "", assignee_id } = req.body;
    if (!goal_id || !project_id || !title) {
      return res.status(400).json({ error: "goal_id, project_id, and title are required" });
    }

    const result = db.prepare(`
      INSERT INTO tasks (goal_id, project_id, title, description, assignee_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(goal_id, project_id, title, description, assignee_id ?? null);

    const task = db.prepare("SELECT * FROM tasks WHERE rowid = ?").get(result.lastInsertRowid);
    broadcast("task:updated", task);
    res.status(201).json(task);
  });

  // Update task
  router.patch("/:id", (req, res) => {
    const { title, description, assignee_id, status, verification_id } = req.body;
    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Task not found" });

    db.prepare(`
      UPDATE tasks SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        assignee_id = COALESCE(?, assignee_id),
        status = COALESCE(?, status),
        verification_id = COALESCE(?, verification_id),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title ?? null,
      description ?? null,
      assignee_id !== undefined ? assignee_id : null,
      status ?? null,
      verification_id ?? null,
      req.params.id,
    );

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
    broadcast("task:updated", updated);

    // Update goal progress if task status changed
    if (status) {
      updateGoalProgress(db, (existing as any).goal_id);
    }

    res.json(updated);
  });

  // Approve task (governance gate: in_review → done)
  router.post("/:id/approve", (req, res) => {
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as any;
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.status !== "in_review") {
      return res.status(400).json({ error: `Cannot approve task in status '${task.status}'. Must be 'in_review'.` });
    }

    db.prepare("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);

    updateGoalProgress(db, task.goal_id);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
    broadcast("task:updated", updated);

    // Log activity
    db.prepare(
      "INSERT INTO activities (project_id, type, message) VALUES (?, 'task_approved', ?)",
    ).run(task.project_id, `Approved: ${task.title}`);

    res.json(updated);
  });

  // Reject task (governance gate: in_review → todo with feedback)
  router.post("/:id/reject", (req, res) => {
    const { feedback } = req.body ?? {};
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as any;
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.status !== "in_review") {
      return res.status(400).json({ error: `Cannot reject task in status '${task.status}'. Must be 'in_review'.` });
    }

    // Append feedback to task description
    const newDesc = feedback
      ? `${task.description}\n\n--- Rejection Feedback ---\n${feedback}`
      : task.description;

    db.prepare(
      "UPDATE tasks SET status = 'todo', description = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(newDesc, req.params.id);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
    broadcast("task:updated", updated);

    db.prepare(
      "INSERT INTO activities (project_id, type, message) VALUES (?, 'task_rejected', ?)",
    ).run(task.project_id, `Rejected: ${task.title}${feedback ? ` — ${feedback}` : ""}`);

    res.json(updated);
  });

  // Delete task
  router.delete("/:id", (req, res) => {
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as any;
    const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Task not found" });
    if (task?.goal_id) updateGoalProgress(db, task.goal_id);
    res.json({ success: true });
  });

  return router;
}

function updateGoalProgress(db: any, goalId: string): void {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
    FROM tasks WHERE goal_id = ?
  `).get(goalId) as { total: number; done: number };

  const progress = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  db.prepare("UPDATE goals SET progress = ? WHERE id = ?").run(progress, goalId);
}
