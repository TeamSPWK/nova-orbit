import { Router } from "express";
import type { AppContext } from "../../index.js";
import { createLogger } from "../../utils/logger.js";
import { parseStreamJson } from "../../core/agent/adapters/stream-parser.js";
import { MAX_TITLE_LEN, MAX_DESC_LEN } from "../../utils/constants.js";

const log = createLogger("goals");

export function createGoalRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  // List goals by project
  router.get("/", (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    if (!projectId) return res.status(400).json({ error: "projectId query param required" });

    const goals = db.prepare(
      `SELECT g.*,
        CASE WHEN gs.id IS NOT NULL THEN 1 ELSE 0 END AS has_spec,
        gs.prd_summary AS _raw_prd
       FROM goals g LEFT JOIN goal_specs gs ON g.id = gs.goal_id
       WHERE g.project_id = ? ORDER BY g.priority, g.created_at`,
    ).all(projectId) as any[];
    // Derive spec_status from prd_summary JSON
    res.json(goals.map((g) => {
      let spec_status: string | null = null;
      if (g._raw_prd) {
        try {
          const prd = JSON.parse(g._raw_prd);
          if (prd._status) spec_status = prd._status; // "generating" | "failed"
        } catch { /* not JSON */ }
      }
      const { _raw_prd, ...rest } = g;
      return { ...rest, spec_status };
    }));
  });

  // Create goal — triggers autopilot if enabled
  router.post("/", (req, res) => {
    const { project_id, title, description, priority = "medium", references } = req.body;
    // Input validation: type + length (prevents oversized payloads DoS)
    if (typeof project_id !== "string" || project_id.length === 0) {
      return res.status(400).json({ error: "project_id (string) is required" });
    }
    if (title != null && typeof title !== "string") {
      return res.status(400).json({ error: "title must be a string" });
    }
    if (description != null && typeof description !== "string") {
      return res.status(400).json({ error: "description must be a string" });
    }
    // Support both: title+description (new) and description-only (legacy)
    const goalTitle = (title ?? "").slice(0, MAX_TITLE_LEN);
    const goalDescription = (description ?? "").slice(0, MAX_DESC_LEN);
    const goalRefs = Array.isArray(references) ? JSON.stringify(references.slice(0, 20)) : "[]";
    if (!goalTitle && !goalDescription) {
      return res.status(400).json({ error: "title or description is required" });
    }

    const VALID_PRIORITIES = ["critical", "high", "medium", "low"];
    if (!VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` });
    }

    try {
      const result = db.prepare(
        "INSERT INTO goals (project_id, title, description, priority, \"references\") VALUES (?, ?, ?, ?, ?)",
      ).run(project_id, goalTitle, goalDescription, priority, goalRefs);

      const goal = db.prepare("SELECT * FROM goals WHERE rowid = ?").get(result.lastInsertRowid) as any;
      broadcast("project:updated", { projectId: project_id });
      res.status(201).json(goal);

      // --- Autopilot trigger (async, after response) ---
      // When client already requested spec (withSpec=true), client handles the flow.
      // Otherwise in autopilot mode: generate spec first, then decompose after spec completes.
      // The spec→decompose chain is handled by the generate-spec endpoint's .then() callback.
      const withSpec = req.body.withSpec === true;
      if (!withSpec) {
        const project = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(project_id) as { autopilot: string } | undefined;
        if (project && (project.autopilot === "goal" || project.autopilot === "full")) {
          if (ctx.generateGoalSpec) {
            // Auto-generate spec first → decompose after spec completes
            log.info(`Autopilot: auto-generating spec for goal ${goal.id} before decompose`);

            // Create placeholder spec row
            db.prepare(
              "INSERT INTO goal_specs (goal_id, prd_summary, feature_specs, user_flow, acceptance_criteria, tech_considerations, generated_by) VALUES (?, '{\"_status\":\"generating\"}', '[]', '[]', '[]', '[]', 'ai')"
            ).run(goal.id);

            ctx.generateGoalSpec(goal.id).then(() => {
              log.info(`Autopilot: spec completed for goal ${goal.id}, triggering decompose`);
              broadcast("project:updated", { projectId: project_id });
              triggerAutopilotDecompose(goal.id, project_id);
            }).catch((err: any) => {
              log.error(`Autopilot: spec generation failed for goal ${goal.id}`, err);
              const errorMsg = (err.message || "Unknown error").slice(0, 200).replace(/"/g, "'");
              const failedJson = JSON.stringify({ _status: "failed", _error: errorMsg });
              db.prepare("UPDATE goal_specs SET prd_summary = ?, updated_at = datetime('now') WHERE goal_id = ?")
                .run(failedJson, goal.id);
              broadcast("project:updated", { projectId: project_id });
            });
          } else {
            // Fallback: no spec engine, decompose directly
            triggerAutopilotDecompose(goal.id, project_id);
          }
        }
      }
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update goal progress
  router.patch("/:id", (req, res) => {
    const { title, description, priority, progress, references } = req.body;
    // Input type validation
    if (title != null && typeof title !== "string") {
      return res.status(400).json({ error: "title must be a string" });
    }
    if (description != null && typeof description !== "string") {
      return res.status(400).json({ error: "description must be a string" });
    }
    if (progress != null && (typeof progress !== "number" || progress < 0 || progress > 100)) {
      return res.status(400).json({ error: "progress must be a number 0..100" });
    }

    const refsJson = Array.isArray(references) ? JSON.stringify(references.slice(0, 20)) : null;
    const boundedTitle = typeof title === "string" ? title.slice(0, MAX_TITLE_LEN) : null;
    const boundedDesc = typeof description === "string" ? description.slice(0, MAX_DESC_LEN) : null;

    // Transactional update — existence check + UPDATE atomically, prevents
    // race with concurrent DELETE wiping the row between SELECT and UPDATE.
    const update = db.transaction(() => {
      const existing = db.prepare("SELECT id FROM goals WHERE id = ?").get(req.params.id) as { id: string } | undefined;
      if (!existing) return null;
      db.prepare(`
        UPDATE goals SET
          title = COALESCE(?, title),
          description = COALESCE(?, description),
          priority = COALESCE(?, priority),
          progress = COALESCE(?, progress),
          "references" = COALESCE(?, "references")
        WHERE id = ?
      `).run(boundedTitle, boundedDesc, priority ?? null, progress ?? null, refsJson, req.params.id);
      return db.prepare("SELECT * FROM goals WHERE id = ?").get(req.params.id);
    });

    try {
      const updated = update();
      if (!updated) return res.status(404).json({ error: "Goal not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete goal — kill sessions for in-progress tasks before CASCADE delete
  router.delete("/:id", (req, res) => {
    const goalId = req.params.id;
    // Collect info atomically before delete to hand off session cleanup
    type DeleteInfo = { projectId: string; assigneeIds: string[] } | null;
    const deleteInfo = db.transaction((): DeleteInfo => {
      const goal = db.prepare("SELECT project_id FROM goals WHERE id = ?").get(goalId) as { project_id: string } | undefined;
      if (!goal) return null;
      const activeTasks = db.prepare(
        "SELECT assignee_id FROM tasks WHERE goal_id = ? AND status IN ('in_progress', 'in_review') AND assignee_id IS NOT NULL",
      ).all(goalId) as { assignee_id: string }[];
      db.prepare("DELETE FROM goals WHERE id = ?").run(goalId);
      return { projectId: goal.project_id, assigneeIds: activeTasks.map((t) => t.assignee_id) };
    })();

    if (!deleteInfo) return res.status(404).json({ error: "Goal not found" });
    // Kill sessions after commit — side-effects must not run inside the txn
    for (const assigneeId of deleteInfo.assigneeIds) {
      try { ctx.sessionManager?.killSession(assigneeId); } catch { /* ignore */ }
    }
    broadcast("project:updated", { projectId: deleteInfo.projectId });
    res.json({ success: true });
  });

  // ─── AI Goal Suggestion ─────────────────────────────────

  // Suggest goals using AI — synchronous (waits for response)
  router.post("/suggest", async (req, res) => {
    // Extend timeout for AI response (up to 5 min)
    req.setTimeout(300000);
    res.setTimeout(300000);
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: "project_id required" });

    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(project_id) as any;
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Find CTO or PM or first agent
    const agent = (db.prepare(
      "SELECT * FROM agents WHERE project_id = ? AND role IN ('cto', 'pm') LIMIT 1",
    ).get(project_id) as any)
      ?? (db.prepare(
        "SELECT * FROM agents WHERE project_id = ? LIMIT 1",
      ).get(project_id) as any);

    if (!agent) return res.status(400).json({ error: "No agents available — add agents first" });

    const techStack = project.tech_stack ? JSON.parse(project.tech_stack) : null;
    const techInfo = techStack
      ? `\nTech Stack: ${techStack.languages?.join(", ")} / ${techStack.frameworks?.join(", ")}`
      : "";

    // Existing goals for context
    const existingGoals = db.prepare("SELECT title, description, status FROM goals WHERE project_id = ?").all(project_id) as any[];
    const existingContext = existingGoals.length > 0
      ? `\n\nExisting goals (avoid duplicates):\n${existingGoals.map((g: any) => `- [${g.status}] ${g.title}: ${g.description || ""}`).join("\n")}`
      : "";

    // Load project docs for context
    let docsContext = "";
    if (project.workdir) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      for (const docFile of ["CLAUDE.md", "README.md"]) {
        const p = path.join(project.workdir, docFile);
        try {
          if (fs.existsSync(p)) {
            docsContext += `\n\n[${docFile}]\n${fs.readFileSync(p, "utf-8").slice(0, 2000)}`;
            break; // One file is enough for suggestion context
          }
        } catch { /* skip */ }
      }
    }

    const prompt = `You are a senior product strategist. Analyze this project and suggest 3-5 actionable goals.

Project: ${project.name}
Mission: ${project.mission || "(not set)"}${techInfo}${existingContext}${docsContext}

Respond in this EXACT JSON format (no markdown, just raw JSON):
[
  {
    "title": "Short goal title (under 60 chars)",
    "description": "2-3 sentence description with context and success criteria",
    "priority": "high|medium|low",
    "reason": "Why this goal matters now (1 sentence)"
  }
]

Rules:
- Each goal should be concrete and actionable, not vague
- Focus on what would deliver the most value for this specific project
- Consider the existing goals and suggest complementary ones
- Respond in the same language as the project mission/name (Korean if Korean, English if English)`;

    try {
      if (!ctx.sessionManager) {
        return res.status(503).json({ error: "Session manager not ready" });
      }
      const suggestKey = `suggest-${project_id}-${Date.now()}`;
      const session = ctx.sessionManager.spawnAgent(agent.id, project.workdir || process.cwd(), suggestKey);
      try {
        const result = await session.send(prompt);

        // Check CLI exit code
        if (result.exitCode !== 0 && result.stdout.trim() === "") {
          const hint = result.stderr.slice(0, 300);
          throw new Error(`Claude Code CLI failed (exit ${result.exitCode}): ${hint}`);
        }

        const parsed = parseStreamJson(result.stdout);
        const raw = parsed.text || "";

        if (!raw.trim()) {
          throw new Error("Goal suggestion produced no text output");
        }

        // Parse JSON from response
        const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\[[\s\S]*\])/);
        const jsonStr = jsonMatch ? jsonMatch[1] : raw;
        const suggestions = JSON.parse(jsonStr);

        if (!Array.isArray(suggestions)) throw new Error("Expected array");

        res.json(suggestions.slice(0, 5).map((s: any) => ({
          title: String(s.title || "").slice(0, 100),
          description: String(s.description || "").slice(0, 500),
          priority: ["high", "medium", "low"].includes(s.priority) ? s.priority : "medium",
          reason: String(s.reason || "").slice(0, 200),
        })));
      } finally {
        ctx.sessionManager.killSession(suggestKey);
      }
    } catch (err: any) {
      log.error("Failed to suggest goals", err);
      res.status(500).json({ error: err.message || "Goal suggestion failed", detail: String(err.stack || "").slice(0, 500) });
    }
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
