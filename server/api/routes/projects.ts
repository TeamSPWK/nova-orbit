import { Router } from "express";
import { existsSync } from "node:fs";
import type { AppContext } from "../../index.js";
import { validateWorkdir } from "../../utils/validate-path.js";
import { analyzeProject } from "../../core/project/analyzer.js";
import { connectGitHub } from "../../core/project/github.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("projects");

export function createProjectRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  // List all projects
  router.get("/", (_req, res) => {
    const projects = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
    res.json(projects);
  });

  // Get single project
  router.get("/:id", (req, res) => {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  });

  // Create project
  router.post("/", (req, res) => {
    const { name, mission, source = "new", workdir = "", github_config, tech_stack } = req.body;

    if (!name) return res.status(400).json({ error: "name is required" });

    // Validate workdir if provided
    let validatedWorkdir = workdir;
    if (workdir && workdir.trim()) {
      try {
        validatedWorkdir = validateWorkdir(workdir);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }
    }

    const result = db.prepare(`
      INSERT INTO projects (name, mission, source, workdir, github_config, tech_stack)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      name,
      mission ?? "",
      source,
      validatedWorkdir,
      github_config ? JSON.stringify(github_config) : null,
      tech_stack ? JSON.stringify(tech_stack) : null,
    );

    const project = db.prepare("SELECT * FROM projects WHERE rowid = ?").get(result.lastInsertRowid);
    broadcast("project:updated", project);
    res.status(201).json(project);
  });

  // Update project
  router.patch("/:id", (req, res) => {
    // Accept both `github_config` (snake_case) and `github` (camelCase from dashboard)
    const { name, mission, status, workdir: rawWorkdir, tech_stack, autopilot } = req.body;
    const github_config = req.body.github_config ?? req.body.github;
    const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: "Project not found" });

    // Validate workdir if provided
    let workdir = rawWorkdir;
    if (rawWorkdir !== undefined && rawWorkdir !== "") {
      try {
        workdir = validateWorkdir(rawWorkdir);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }
    }

    // Validate autopilot mode
    const VALID_AUTOPILOT = ["off", "goal", "full"];
    if (autopilot !== undefined && !VALID_AUTOPILOT.includes(autopilot)) {
      return res.status(400).json({ error: `Invalid autopilot mode. Must be one of: ${VALID_AUTOPILOT.join(", ")}` });
    }

    // Full mode requires mission and CTO agent
    if (autopilot === "full") {
      const proj = db.prepare("SELECT mission FROM projects WHERE id = ?").get(req.params.id) as any;
      const effectiveMission = mission ?? proj?.mission;
      if (!effectiveMission || effectiveMission.trim() === "") {
        return res.status(400).json({ error: "Full autopilot requires a project mission" });
      }
      const cto = db.prepare("SELECT id FROM agents WHERE project_id = ? AND role = 'cto' LIMIT 1").get(req.params.id);
      if (!cto) {
        return res.status(400).json({ error: "Full autopilot requires a CTO agent in the team" });
      }
    }

    db.prepare(`
      UPDATE projects SET
        name = COALESCE(?, name),
        mission = COALESCE(?, mission),
        status = COALESCE(?, status),
        workdir = COALESCE(?, workdir),
        github_config = COALESCE(?, github_config),
        tech_stack = COALESCE(?, tech_stack),
        autopilot = COALESCE(?, autopilot),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name ?? null,
      mission ?? null,
      status ?? null,
      workdir ?? null,
      github_config ? JSON.stringify(github_config) : null,
      tech_stack ? JSON.stringify(tech_stack) : null,
      autopilot ?? null,
      req.params.id,
    );

    const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
    broadcast("project:updated", updated);
    broadcast("autopilot:mode-changed", { projectId: req.params.id, mode: autopilot ?? existing.autopilot });
    res.json(updated);

    // Trigger Full autopilot if switching to 'full' from another mode
    if (autopilot === "full" && existing.autopilot !== "full") {
      triggerFullAutopilot(req.params.id);
    }
  });

  // Analyze a local directory (for project import)
  router.post("/analyze", (req, res) => {
    const { path: inputPath } = req.body;
    if (!inputPath) return res.status(400).json({ error: "path is required" });

    let resolved: string;
    try {
      resolved = validateWorkdir(inputPath);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    if (!existsSync(resolved)) return res.status(400).json({ error: "Directory not found" });

    try {
      const analysis = analyzeProject(resolved);
      res.json(analysis);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Import a local project (analyze + create + suggest agents)
  router.post("/import", (req, res) => {
    const { path: dirPath, name } = req.body;
    if (!dirPath) return res.status(400).json({ error: "path is required" });

    let resolvedImport: string;
    try {
      resolvedImport = validateWorkdir(dirPath);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
    if (!existsSync(resolvedImport)) return res.status(400).json({ error: "Directory not found" });

    try {
      const analysis = analyzeProject(resolvedImport);
      const projectName = name || resolvedImport.split("/").pop() || "Imported Project";

      // Create project
      const result = db.prepare(`
        INSERT INTO projects (name, source, workdir, tech_stack)
        VALUES (?, 'local_import', ?, ?)
      `).run(projectName, resolvedImport, JSON.stringify(analysis.techStack));

      const project = db.prepare("SELECT * FROM projects WHERE rowid = ?").get(result.lastInsertRowid) as any;

      // Create suggested agents
      for (const agent of analysis.suggestedAgents) {
        db.prepare(`
          INSERT INTO agents (project_id, name, role)
          VALUES (?, ?, ?)
        `).run(project.id, agent.name, agent.role);
      }

      const agents = db.prepare("SELECT * FROM agents WHERE project_id = ?").all(project.id);

      broadcast("project:updated", project);
      res.status(201).json({
        project,
        agents,
        analysis,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Connect GitHub repo (clone + analyze + create project + agents)
  router.post("/github", (req, res) => {
    const { url, name } = req.body;
    if (!url) return res.status(400).json({ error: "url is required" });

    // SSRF 방어: HTTP/HTTPS + github.com만 허용
    const trimmedUrl = String(url).trim();
    if (!/^https?:\/\/github\.com\//i.test(trimmedUrl) && !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmedUrl)) {
      return res.status(400).json({ error: "Only GitHub HTTPS URLs or owner/repo format allowed" });
    }

    try {
      const dataDir = process.env.NOVA_ORBIT_DATA_DIR || ".nova-orbit";
      const result = connectGitHub(url, dataDir);
      const projectName = name || url.split("/").pop()?.replace(/\.git$/, "") || "GitHub Project";

      // Validate localPath is within allowed directories
      const validatedPath = validateWorkdir(result.localPath);

      // Create project
      const dbResult = db.prepare(`
        INSERT INTO projects (name, source, workdir, github_config, tech_stack)
        VALUES (?, 'github', ?, ?, ?)
      `).run(
        projectName,
        validatedPath,
        JSON.stringify({ repoUrl: result.repoUrl, branch: result.branch, autoPush: false, prMode: true }),
        JSON.stringify(result.analysis.techStack),
      );

      const project = db.prepare("SELECT * FROM projects WHERE rowid = ?").get(dbResult.lastInsertRowid) as any;

      // Create suggested agents
      for (const agent of result.analysis.suggestedAgents) {
        db.prepare("INSERT INTO agents (project_id, name, role) VALUES (?, ?, ?)")
          .run(project.id, agent.name, agent.role);
      }

      const agents = db.prepare("SELECT * FROM agents WHERE project_id = ?").all(project.id);

      broadcast("project:updated", project);
      res.status(201).json({ project, agents, analysis: result.analysis, branch: result.branch });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete project
  router.delete("/:id", (req, res) => {
    const result = db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Project not found" });
    ctx.devServerManager.stop(req.params.id);
    broadcast("project:updated", { id: req.params.id, deleted: true });
    res.json({ success: true });
  });

  // Cost tracking: token usage and cost per agent for a project (Sprint 5)
  router.get("/:id/cost", (req, res) => {
    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const costs = db.prepare(`
      SELECT
        a.id        AS agentId,
        a.name      AS agentName,
        a.role,
        COALESCE(SUM(s.token_usage), 0) AS totalTokens,
        COALESCE(SUM(s.cost_usd), 0)    AS totalCost
      FROM agents a
      LEFT JOIN sessions s ON s.agent_id = a.id
      WHERE a.project_id = ?
      GROUP BY a.id
      ORDER BY totalCost DESC
    `).all(req.params.id);

    res.json({ costs });
  });

  // Dev server routes
  router.post("/:id/dev-server/start", async (req, res) => {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) as any;
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!project.workdir) return res.status(400).json({ error: "Project has no workdir configured" });

    try {
      const { port, url } = await ctx.devServerManager.start(req.params.id, project.workdir);
      res.json({ status: "started", port, url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/:id/dev-server/stop", (req, res) => {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) as any;
    if (!project) return res.status(404).json({ error: "Project not found" });

    ctx.devServerManager.stop(req.params.id);
    res.json({ status: "stopped" });
  });

  router.get("/:id/dev-server/status", (req, res) => {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) as any;
    if (!project) return res.status(404).json({ error: "Project not found" });

    const status = ctx.devServerManager.getStatus(req.params.id);
    res.json(status);
  });

  // --- Full autopilot: generate goals from mission, decompose, run queue ---
  async function triggerFullAutopilot(projectId: string) {
    if (!ctx.orchestrationEngine || !ctx.scheduler) {
      log.warn("Full autopilot trigger skipped: orchestration not initialized");
      return;
    }

    try {
      log.info(`Full autopilot started for project ${projectId}`);

      // Step 1: CTO generates goals from mission
      const { goalIds } = await ctx.orchestrationEngine.generateGoalsFromMission(projectId);

      if (goalIds.length === 0) {
        log.warn("Full autopilot: no goals generated, downgrading to goal mode");
        db.prepare("UPDATE projects SET autopilot = 'goal', updated_at = datetime('now') WHERE id = ?").run(projectId);
        broadcast("autopilot:full-completed", { projectId, reason: "no_goals" });
        broadcast("autopilot:mode-changed", { projectId, mode: "goal" });
        return;
      }

      // Step 2: Decompose each goal
      for (const goalId of goalIds) {
        try {
          // Guard: re-check autopilot mode (user may have switched mid-run)
          const current = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(projectId) as any;
          if (current?.autopilot !== "full") {
            log.info("Full autopilot: mode changed during execution, stopping");
            return;
          }

          await ctx.orchestrationEngine.decomposeGoal(goalId);
        } catch (err: any) {
          log.error(`Full autopilot: failed to decompose goal ${goalId}`, err);
          // Continue with other goals — don't let one failure block all
        }
      }

      // Step 3: Start queue
      if (!ctx.scheduler.isRunning(projectId)) {
        ctx.scheduler.startQueue(projectId);
      }

      // Step 4: Downgrade to 'goal' mode after generation complete
      // (Tasks will continue executing, but no new goals will be auto-generated)
      db.prepare("UPDATE projects SET autopilot = 'goal', updated_at = datetime('now') WHERE id = ?").run(projectId);
      broadcast("autopilot:full-completed", { projectId, reason: "goals_generated", goalCount: goalIds.length });
      broadcast("autopilot:mode-changed", { projectId, mode: "goal" });
      broadcast("project:updated", { projectId });

      log.info(`Full autopilot completed: ${goalIds.length} goals generated, downgraded to goal mode`);
    } catch (err: any) {
      log.error(`Full autopilot failed for project ${projectId}`, err);

      // Safety: downgrade to goal mode on failure
      db.prepare("UPDATE projects SET autopilot = 'goal', updated_at = datetime('now') WHERE id = ?").run(projectId);
      broadcast("autopilot:full-completed", { projectId, reason: "error", error: err.message });
      broadcast("autopilot:mode-changed", { projectId, mode: "goal" });

      db.prepare(
        "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_error', ?)",
      ).run(projectId, `Full autopilot failed: ${err.message?.slice(0, 200)}`);
    }
  }

  return router;
}
