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

    const rawLimit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 200;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;

    const goals = db.prepare(
      `SELECT g.*,
        CASE WHEN gs.id IS NOT NULL THEN 1 ELSE 0 END AS has_spec,
        gs.prd_summary AS _raw_prd
       FROM goals g LEFT JOIN goal_specs gs ON g.id = gs.goal_id
       WHERE g.project_id = ? ORDER BY g.priority, g.created_at LIMIT ?`,
    ).all(projectId, limit) as any[];
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
      // Assign sort_order at end of existing goals so new entries don't
      // collide with (and jump above) existing ones in scheduler ordering.
      const sortOrder = (db.prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM goals WHERE project_id = ?",
      ).get(project_id) as { next: number }).next;

      const result = db.prepare(
        "INSERT INTO goals (project_id, title, description, priority, \"references\", sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(project_id, goalTitle, goalDescription, priority, goalRefs, sortOrder);

      const goal = db.prepare("SELECT * FROM goals WHERE rowid = ?").get(result.lastInsertRowid) as any;
      broadcast("project:updated", { projectId: project_id });

      // Check autopilot BEFORE responding so client knows whether to skip its own spec call
      const project = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(project_id) as { autopilot: string } | undefined;
      const autopilotActive = !!(project && (project.autopilot === "goal" || project.autopilot === "full"));

      res.status(201).json({ ...goal, autopilotHandled: autopilotActive });

      // --- Autopilot trigger (async, after response) ---
      // In autopilot mode: ALWAYS delegate to scheduler regardless of withSpec.
      // The scheduler handles spec→decompose sequentially in priority/sort_order.
      // This prevents parallel spec generation when multiple goals are added at once.
      if (autopilotActive && ctx.scheduler) {
        log.info(`Autopilot: goal ${goal.id} added, notifying scheduler for sequential processing`);
        ctx.scheduler.notifyGoalReady(project_id);
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
    // Also kill any spec-generation or decompose session for this goal
    try { ctx.sessionManager?.killSession(`spec-${goalId}`); } catch { /* ignore */ }
    try { ctx.sessionManager?.killSession(`decompose-${goalId}`); } catch { /* ignore */ }
    broadcast("project:updated", { projectId: deleteInfo.projectId });
    res.json({ success: true });
  });

  // ─── AI Goal Suggestion ─────────────────────────────────

  // Suggest goals using AI — synchronous (waits for response)
  router.post("/suggest", async (req, res) => {
    // Extend timeout for AI response (up to 5 min)
    req.setTimeout(300000);
    res.setTimeout(300000);
    const { project_id, count: rawCount } = req.body;
    if (!project_id) return res.status(400).json({ error: "project_id required" });
    const count = Math.max(1, Math.min(10, Number(rawCount) || 3));

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
    const existingGoals = db.prepare("SELECT title, description, progress FROM goals WHERE project_id = ?").all(project_id) as any[];
    const goalStatusLabel = (p: number) => (p >= 100 ? "done" : p > 0 ? "in-progress" : "todo");
    const existingContext = existingGoals.length > 0
      ? `\n\nExisting goals (avoid duplicates):\n${existingGoals.map((g: any) => `- [${goalStatusLabel(g.progress ?? 0)}] ${g.title}: ${g.description || ""}`).join("\n")}`
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

    const prompt = `You are a senior product strategist. Analyze this project and suggest exactly ${count} actionable goals.

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

        res.json(suggestions.slice(0, count).map((s: any) => ({
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

      // Spec complete → notify scheduler so it can decompose in priority order.
      // Previously called triggerAutopilotDecompose directly, which bypassed
      // the scheduler's sequential lock and caused parallel decompose races.
      if (ctx.scheduler) {
        const project = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(goal.project_id) as { autopilot: string } | undefined;
        if (project && (project.autopilot === "goal" || project.autopilot === "full")) {
          ctx.scheduler.notifyGoalReady(goal.project_id);
        }
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

  return router;
}
