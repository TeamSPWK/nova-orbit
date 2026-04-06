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
      // When client will generate a spec first (withSpec=true), skip auto-decompose
      // to avoid session conflict — decompose runs after spec generation completes instead.
      const withSpec = req.body.withSpec === true;
      if (!withSpec) {
        const project = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(project_id) as { autopilot: string } | undefined;
        if (project && (project.autopilot === "goal" || project.autopilot === "full")) {
          triggerAutopilotDecompose(goal.id, project_id);
        }
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

  // Delete goal — kill sessions for in-progress tasks before CASCADE delete
  router.delete("/:id", (req, res) => {
    const goalId = req.params.id;
    const goal = db.prepare("SELECT project_id FROM goals WHERE id = ?").get(goalId) as { project_id: string } | undefined;
    if (!goal) return res.status(404).json({ error: "Goal not found" });
    // Kill sessions for any in-progress tasks under this goal
    const activeTasks = db.prepare(
      "SELECT assignee_id FROM tasks WHERE goal_id = ? AND status IN ('in_progress', 'in_review') AND assignee_id IS NOT NULL",
    ).all(goalId) as { assignee_id: string }[];
    for (const t of activeTasks) {
      ctx.sessionManager?.killSession(t.assignee_id);
    }
    db.prepare("DELETE FROM goals WHERE id = ?").run(goalId);
    broadcast("project:updated", { projectId: goal.project_id });
    res.json({ success: true });
  });

  // ─── Goal Spec endpoints ───────────────────────────────

  // Get spec for a goal
  router.get("/:id/spec", (req, res) => {
    const spec = db.prepare("SELECT * FROM goal_specs WHERE goal_id = ?").get(req.params.id) as any;
    if (!spec) return res.status(404).json({ error: "Spec not found for this goal" });
    res.json({
      id: spec.id,
      goal_id: spec.goal_id,
      prd_summary: JSON.parse(spec.prd_summary || "{}"),
      feature_specs: JSON.parse(spec.feature_specs || "[]"),
      user_flow: JSON.parse(spec.user_flow || "[]"),
      acceptance_criteria: JSON.parse(spec.acceptance_criteria || "[]"),
      tech_considerations: JSON.parse(spec.tech_considerations || "[]"),
      generated_by: spec.generated_by,
      version: spec.version,
      created_at: spec.created_at,
      updated_at: spec.updated_at,
    });
  });

  // Update spec manually
  router.patch("/:id/spec", (req, res) => {
    const goalId = req.params.id;
    const existing = db.prepare("SELECT * FROM goal_specs WHERE goal_id = ?").get(goalId) as any;
    if (!existing) return res.status(404).json({ error: "Spec not found" });

    const { prd_summary, feature_specs, user_flow, acceptance_criteria, tech_considerations } = req.body;

    try {
      db.prepare(`
        UPDATE goal_specs SET
          prd_summary = COALESCE(?, prd_summary),
          feature_specs = COALESCE(?, feature_specs),
          user_flow = COALESCE(?, user_flow),
          acceptance_criteria = COALESCE(?, acceptance_criteria),
          tech_considerations = COALESCE(?, tech_considerations),
          generated_by = 'manual',
          version = version + 1,
          updated_at = datetime('now')
        WHERE goal_id = ?
      `).run(
        prd_summary ? JSON.stringify(prd_summary) : null,
        feature_specs ? JSON.stringify(feature_specs) : null,
        user_flow ? JSON.stringify(user_flow) : null,
        acceptance_criteria ? JSON.stringify(acceptance_criteria) : null,
        tech_considerations ? JSON.stringify(tech_considerations) : null,
        goalId,
      );

      const updated = db.prepare("SELECT * FROM goal_specs WHERE goal_id = ?").get(goalId) as any;
      res.json({
        ...updated,
        prd_summary: JSON.parse(updated.prd_summary),
        feature_specs: JSON.parse(updated.feature_specs),
        user_flow: JSON.parse(updated.user_flow),
        acceptance_criteria: JSON.parse(updated.acceptance_criteria),
        tech_considerations: JSON.parse(updated.tech_considerations),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Generate spec using AI — fire-and-forget pattern
  // Returns 202 immediately, generation continues in background.
  // Client polls GET /goals/:id/spec for result.
  router.post("/:id/generate-spec", (req, res) => {
    const goalId = req.params.id;
    const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as any;
    if (!goal) return res.status(404).json({ error: "Goal not found" });

    if (!ctx.generateGoalSpec) {
      return res.status(503).json({ error: "Orchestration engine not ready" });
    }

    // Mark as generating (client can check this)
    const existing = db.prepare("SELECT id FROM goal_specs WHERE goal_id = ?").get(goalId) as any;
    if (!existing) {
      db.prepare(
        "INSERT INTO goal_specs (goal_id, prd_summary, feature_specs, user_flow, acceptance_criteria, tech_considerations, generated_by) VALUES (?, '{\"_status\":\"generating\"}', '[]', '[]', '[]', '[]', 'ai')"
      ).run(goalId);
    } else {
      db.prepare("UPDATE goal_specs SET prd_summary = '{\"_status\":\"generating\"}', updated_at = datetime('now') WHERE goal_id = ?").run(goalId);
    }

    // Return immediately
    res.status(202).json({ status: "generating", goalId });

    // Background generation
    ctx.generateGoalSpec(goalId).then(() => {
      log.info(`Spec generated for goal ${goalId}`);
      broadcast("project:updated", { projectId: goal.project_id });

      // Spec complete → trigger autopilot decompose if enabled
      const project = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(goal.project_id) as { autopilot: string } | undefined;
      if (project && (project.autopilot === "goal" || project.autopilot === "full")) {
        triggerAutopilotDecompose(goalId, goal.project_id);
      }
    }).catch((err: any) => {
      log.error(`Failed to generate spec for goal ${goalId}`, err);
      // Store failure status as proper JSON (avoid SQL string concat which breaks on quotes)
      const errorMsg = (err.message || "Unknown error").slice(0, 200).replace(/"/g, "'");
      const failedJson = JSON.stringify({ _status: "failed", _error: errorMsg });
      db.prepare("UPDATE goal_specs SET prd_summary = ?, updated_at = datetime('now') WHERE goal_id = ?")
        .run(failedJson, goalId);
      broadcast("project:updated", { projectId: goal.project_id });
    });
  });

  // AI Refine — user sends a custom prompt to modify existing spec
  router.post("/:id/refine-spec", async (req, res) => {
    const goalId = req.params.id;
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }

    const specRow = db.prepare("SELECT * FROM goal_specs WHERE goal_id = ?").get(goalId) as any;
    if (!specRow) return res.status(404).json({ error: "No spec to refine — generate one first" });

    const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as any;
    if (!goal) return res.status(404).json({ error: "Goal not found" });

    if (!ctx.generateGoalSpec) {
      return res.status(503).json({ error: "Orchestration engine not ready" });
    }

    // Use the refine function (registered from orchestration routes)
    if (!(ctx as any).refineGoalSpec) {
      return res.status(503).json({ error: "Refine not available" });
    }

    try {
      const result = await (ctx as any).refineGoalSpec(goalId, prompt);
      res.json(result);
    } catch (err: any) {
      log.error(`Failed to refine spec for goal ${goalId}`, err);
      res.status(500).json({ error: err.message });
    }
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

      // Skip if spec is currently being generated — decompose should wait for spec
      const spec = db.prepare("SELECT prd_summary FROM goal_specs WHERE goal_id = ?").get(goalId) as { prd_summary: string } | undefined;
      if (spec) {
        try {
          const prd = JSON.parse(spec.prd_summary);
          if (prd._status === "generating") {
            log.info(`Autopilot: goal ${goalId} has spec in progress, skipping decompose (will be triggered after spec completes)`);
            return;
          }
        } catch { /* not JSON, proceed */ }
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

      // Fallback: if tasks were partially created before the error, auto-approve them
      const pending = db.prepare(
        "UPDATE tasks SET status = 'todo' WHERE goal_id = ? AND status = 'pending_approval'"
      ).run(goalId);
      if (pending.changes > 0) {
        log.info(`Autopilot fallback: auto-approved ${pending.changes} partially created tasks for goal ${goalId}`);
        broadcast("project:updated", { projectId });

        if (ctx.scheduler && !ctx.scheduler.isRunning(projectId)) {
          ctx.scheduler.startQueue(projectId);
        }
      }
    }
  }

  return router;
}
