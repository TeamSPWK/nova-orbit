import { Router } from "express";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import type { AppContext } from "../../index.js";
import { analyzeProject } from "../../core/project/analyzer.js";
import { connectGitHub } from "../../core/project/github.js";

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

    const result = db.prepare(`
      INSERT INTO projects (name, mission, source, workdir, github_config, tech_stack)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      name,
      mission ?? "",
      source,
      workdir,
      github_config ? JSON.stringify(github_config) : null,
      tech_stack ? JSON.stringify(tech_stack) : null,
    );

    const project = db.prepare("SELECT * FROM projects WHERE rowid = ?").get(result.lastInsertRowid);
    broadcast("project:updated", project);
    res.status(201).json(project);
  });

  // Update project
  router.patch("/:id", (req, res) => {
    const { name, mission, status, workdir, github_config, tech_stack } = req.body;
    const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Project not found" });

    db.prepare(`
      UPDATE projects SET
        name = COALESCE(?, name),
        mission = COALESCE(?, mission),
        status = COALESCE(?, status),
        workdir = COALESCE(?, workdir),
        github_config = COALESCE(?, github_config),
        tech_stack = COALESCE(?, tech_stack),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name ?? null,
      mission ?? null,
      status ?? null,
      workdir ?? null,
      github_config ? JSON.stringify(github_config) : null,
      tech_stack ? JSON.stringify(tech_stack) : null,
      req.params.id,
    );

    const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
    broadcast("project:updated", updated);
    res.json(updated);
  });

  // Analyze a local directory (for project import)
  router.post("/analyze", (req, res) => {
    const { path: inputPath } = req.body;
    if (!inputPath) return res.status(400).json({ error: "path is required" });

    // Resolve to absolute and prevent path traversal
    const resolved = resolvePath(inputPath);
    if (!resolved.startsWith(homedir()) && !resolved.startsWith("/tmp")) {
      return res.status(400).json({ error: "Path must be within home directory" });
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

    // Resolve to absolute and prevent path traversal
    const resolvedImport = resolvePath(dirPath);
    if (!resolvedImport.startsWith(homedir()) && !resolvedImport.startsWith("/tmp")) {
      return res.status(400).json({ error: "Path must be within home directory" });
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

    try {
      const dataDir = process.env.NOVA_ORBIT_DATA_DIR || ".nova-orbit";
      const result = connectGitHub(url, dataDir);
      const projectName = name || url.split("/").pop()?.replace(/\.git$/, "") || "GitHub Project";

      // Create project
      const dbResult = db.prepare(`
        INSERT INTO projects (name, source, workdir, github_config, tech_stack)
        VALUES (?, 'github', ?, ?, ?)
      `).run(
        projectName,
        result.localPath,
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

  return router;
}
