import { Router } from "express";
import type { AppContext } from "../../index.js";

export function createVerificationRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  // List verifications for a task
  router.get("/", (req, res) => {
    const taskId = typeof req.query.taskId === "string" ? req.query.taskId : undefined;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;

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

  // Create a fix task from a failed verification
  router.post("/:id/create-fix-task", (req, res) => {
    const { id } = req.params;

    const verification = db.prepare("SELECT * FROM verifications WHERE id = ?").get(id) as any;
    if (!verification) return res.status(404).json({ error: "Verification not found" });

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(verification.task_id) as any;
    if (!task) return res.status(404).json({ error: "Original task not found" });

    let issues: any[] = [];
    try {
      issues = JSON.parse(verification.issues);
    } catch {
      // fallback to empty
    }

    const issueSummary = issues.length > 0
      ? issues.map((i: any) => i.message ?? String(i)).join("; ").slice(0, 120)
      : "verification issues";

    const title = `Fix: ${issueSummary}`;
    const description = issues.length > 0
      ? `Issues found during verification of "${task.title}":\n\n` +
        issues.map((i: any) =>
          `- [${i.severity ?? "issue"}] ${i.file ? `${i.file}:${i.line ?? ""} — ` : ""}${i.message ?? i}${i.suggestion ? `\n  Suggestion: ${i.suggestion}` : ""}`,
        ).join("\n")
      : `Fix issues found in task "${task.title}".`;

    const result = db.prepare(`
      INSERT INTO tasks (goal_id, project_id, title, description, assignee_id, status)
      VALUES (?, ?, ?, ?, ?, 'todo')
    `).run(task.goal_id, task.project_id, title, description, task.assignee_id ?? null);

    const newTask = db.prepare("SELECT * FROM tasks WHERE rowid = ?").get(result.lastInsertRowid) as any;

    broadcast("task:updated", { ...newTask, action: "created" });

    db.prepare(`
      INSERT INTO activities (project_id, type, message, metadata)
      VALUES (?, 'task_created', ?, ?)
    `).run(
      task.project_id,
      `Fix task created: "${title}"`,
      JSON.stringify({ sourceVerificationId: id, sourceTaskId: task.id }),
    );

    res.status(201).json(newTask);
  });

  return router;
}
