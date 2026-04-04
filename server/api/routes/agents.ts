import { Router } from "express";
import type { AppContext } from "../../index.js";
import { getAgentPresets } from "../../core/agent/roles.js";
import { suggestAgentsFromMission, getTeamPresets } from "../../core/agent/suggest.js";

export function createAgentRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  // List agents (optionally filter by project)
  router.get("/", (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const agents = projectId
      ? db.prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY created_at").all(projectId)
      : db.prepare("SELECT * FROM agents ORDER BY created_at").all();
    res.json(agents);
  });

  // List available agent role presets loaded from templates/agents/*.yaml
  router.get("/presets", (_req, res) => {
    res.json(getAgentPresets());
  });

  // List team presets (org structures)
  router.get("/team-presets", (_req, res) => {
    res.json(getTeamPresets());
  });

  // Create a team from a preset
  router.post("/create-team", (req, res) => {
    const { project_id, preset_id } = req.body;
    if (!project_id || !preset_id) {
      return res.status(400).json({ error: "project_id and preset_id are required" });
    }

    const presets = getTeamPresets();
    const preset = presets.find((p) => p.id === preset_id);
    if (!preset) return res.status(400).json({ error: `Unknown preset: ${preset_id}` });

    try {
      const created: any[] = [];
      const idMap = new Map<string, string>(); // role → agent id

      // First pass: create all agents
      for (const a of preset.agents) {
        const result = db.prepare(
          "INSERT INTO agents (project_id, name, role) VALUES (?, ?, ?)",
        ).run(project_id, a.name, a.role);
        const row = db.prepare("SELECT * FROM agents WHERE rowid = ?").get(result.lastInsertRowid) as any;
        created.push(row);
        idMap.set(a.role, row.id);
      }

      // Second pass: set parent_id for hierarchy
      for (const a of preset.agents) {
        if (a.parentRole) {
          const parentId = idMap.get(a.parentRole);
          const childId = idMap.get(a.role);
          if (parentId && childId) {
            db.prepare("UPDATE agents SET parent_id = ? WHERE id = ?").run(parentId, childId);
          }
        }
      }

      broadcast("project:updated", { projectId: project_id });
      res.status(201).json({ preset: preset.name, created, count: created.length });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Suggest domain-specialized agents based on mission + tech stack
  router.post("/suggest", (req, res) => {
    const { mission, techStack } = req.body;
    if (!mission) return res.status(400).json({ error: "mission is required" });
    const suggestions = suggestAgentsFromMission(mission, techStack);
    res.json(suggestions);
  });

  // Auto-create suggested agents for a project
  router.post("/suggest-and-create", (req, res) => {
    const { project_id, mission, techStack } = req.body;
    if (!project_id || !mission) {
      return res.status(400).json({ error: "project_id and mission are required" });
    }

    const suggestions = suggestAgentsFromMission(mission, techStack);
    const created = [];

    for (const agent of suggestions) {
      const result = db.prepare(`
        INSERT INTO agents (project_id, name, role, system_prompt)
        VALUES (?, ?, ?, ?)
      `).run(project_id, agent.name, agent.role, agent.systemPrompt);

      const row = db.prepare("SELECT * FROM agents WHERE rowid = ?").get(result.lastInsertRowid);
      created.push(row);
    }

    broadcast("project:updated", { projectId: project_id });
    res.status(201).json({ suggestions, created, count: created.length });
  });

  // Get agent stats: taskCount, totalTokens, totalCostUsd
  router.get("/:id/stats", (req, res) => {
    const agent = db.prepare("SELECT id FROM agents WHERE id = ?").get(req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const taskRow = db
      .prepare("SELECT COUNT(*) as taskCount FROM tasks WHERE assignee_id = ? AND status = 'done'")
      .get(req.params.id) as { taskCount: number };

    const sessionRow = db
      .prepare(
        "SELECT COALESCE(SUM(token_usage), 0) as totalTokens, COALESCE(SUM(cost_usd), 0) as totalCostUsd FROM sessions WHERE agent_id = ?",
      )
      .get(req.params.id) as { totalTokens: number; totalCostUsd: number };

    res.json({
      taskCount: taskRow.taskCount,
      totalTokens: sessionRow.totalTokens,
      totalCostUsd: sessionRow.totalCostUsd,
    });
  });

  // Get single agent
  router.get("/:id", (req, res) => {
    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(agent);
  });

  // Create agent
  router.post("/", (req, res) => {
    const { project_id, name, role, system_prompt = "", session_behavior = "resume-or-new" } = req.body;

    if (!project_id || !name || !role) {
      return res.status(400).json({ error: "project_id, name, and role are required" });
    }

    const VALID_ROLES = ["coder", "reviewer", "marketer", "designer", "qa", "custom", "cto", "backend", "frontend", "ux", "devops"];
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` });
    }

    try {
      const result = db.prepare(`
        INSERT INTO agents (project_id, name, role, system_prompt, session_behavior)
        VALUES (?, ?, ?, ?, ?)
      `).run(project_id, name, role, system_prompt, session_behavior);

      const agent = db.prepare("SELECT * FROM agents WHERE rowid = ?").get(result.lastInsertRowid);
      broadcast("agent:status", agent);
      res.status(201).json(agent);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update agent status
  router.patch("/:id", (req, res) => {
    const { status, current_task_id, system_prompt, name } = req.body;
    const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Agent not found" });

    db.prepare(`
      UPDATE agents SET
        status = COALESCE(?, status),
        current_task_id = COALESCE(?, current_task_id),
        system_prompt = COALESCE(?, system_prompt),
        name = COALESCE(?, name)
      WHERE id = ?
    `).run(
      status ?? null,
      current_task_id !== undefined ? current_task_id : null,
      system_prompt ?? null,
      name ?? null,
      req.params.id,
    );

    const updated = db.prepare("SELECT * FROM agents WHERE id = ?").get(req.params.id);
    broadcast("agent:status", updated);
    res.json(updated);
  });

  // Delete agent — kill running session before DB delete
  router.delete("/:id", (req, res) => {
    // Kill any running session for this agent (prevents orphaned processes)
    ctx.sessionManager?.killSession?.(req.params.id);
    const result = db.prepare("DELETE FROM agents WHERE id = ?").run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Agent not found" });
    res.json({ success: true });
  });

  return router;
}
