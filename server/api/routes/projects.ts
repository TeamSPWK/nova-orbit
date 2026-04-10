import { Router } from "express";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { AppContext } from "../../index.js";
import { validateWorkdir } from "../../utils/validate-path.js";
import { analyzeProject } from "../../core/project/analyzer.js";
import { connectGitHub } from "../../core/project/github.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("projects");

export function createProjectRoutes(ctx: AppContext): Router {
  const router = Router();
  const { db, broadcast } = ctx;

  /** Transform raw DB row: parse github_config JSON string → github object for dashboard */
  function toProjectResponse(row: any): any {
    if (!row) return row;
    const { github_config, tech_stack, ...rest } = row;
    return {
      ...rest,
      github: github_config ? (() => { try { return JSON.parse(github_config); } catch { return null; } })() : null,
      tech_stack: tech_stack ? (() => { try { return JSON.parse(tech_stack); } catch { return null; } })() : null,
    };
  }

  // List all projects
  router.get("/", (_req, res) => {
    const projects = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
    res.json(projects.map(toProjectResponse));
  });

  // Get single project
  router.get("/:id", (req, res) => {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(toProjectResponse(project));
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

    const project = toProjectResponse(db.prepare("SELECT * FROM projects WHERE rowid = ?").get(result.lastInsertRowid));
    broadcast("project:updated", project);
    res.status(201).json(project);
  });

  // Update project
  router.patch("/:id", (req, res) => {
    // Accept both `github_config` (snake_case) and `github` (camelCase from dashboard)
    const { name, mission, status, workdir: rawWorkdir, tech_stack, autopilot, dev_port } = req.body;
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

    // dev_port: undefined = 변경 없음, null = 초기화(자동할당), number = 지정
    const devPortClause = dev_port !== undefined ? "dev_port = ?," : "";
    const devPortParams = dev_port !== undefined ? [dev_port] : [];

    db.prepare(`
      UPDATE projects SET
        name = COALESCE(?, name),
        mission = COALESCE(?, mission),
        status = COALESCE(?, status),
        workdir = COALESCE(?, workdir),
        github_config = COALESCE(?, github_config),
        tech_stack = COALESCE(?, tech_stack),
        autopilot = COALESCE(?, autopilot),
        ${devPortClause}
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
      ...devPortParams,
      req.params.id,
    );

    const updated = toProjectResponse(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id));
    broadcast("project:updated", updated);
    broadcast("autopilot:mode-changed", { projectId: req.params.id, mode: autopilot ?? existing.autopilot });
    res.json(updated);

    // Trigger Full autopilot if switching to 'full' from another mode.
    // Skip CTO mission re-generation when incomplete goals already exist —
    // the scheduler will resume them. This prevents accidental goal
    // inflation (and sort_order collisions) when users toggle
    // full → semi → full mid-execution.
    if (autopilot === "full" && existing.autopilot !== "full") {
      const incomplete = db.prepare(
        "SELECT COUNT(*) as cnt FROM goals WHERE project_id = ? AND progress < 100",
      ).get(req.params.id) as { cnt: number };
      if (incomplete.cnt === 0) {
        triggerFullAutopilot(req.params.id);
      } else {
        // Ensure the queue is actually running. If the queue had auto-stopped
        // (e.g. all tasks were blocked without retries when the user switched
        // away), we must restart it so remaining goals can make progress.
        // startQueue is a no-op when the queue is already running.
        if (ctx.scheduler && !ctx.scheduler.isRunning(req.params.id)) {
          ctx.scheduler.startQueue(req.params.id);
          log.info(`Full autopilot re-entry: ${incomplete.cnt} incomplete goal(s) exist, restarted stopped queue`);
        } else {
          log.info(`Full autopilot re-entry: ${incomplete.cnt} incomplete goal(s) exist, queue already running — skipping mission generation`);
        }
      }
    }

    // Autopilot off → goal/full: rescue pending goals AND start queue for
    // existing todo tasks. Without this:
    //   (a) Goals created in manual mode stay at 0 tasks (no decompose)
    //   (b) Already-decomposed goals with todo tasks sit idle (no queue)
    // Both are confusing — user enables autopilot expecting work to start.
    const switchedOn =
      autopilot && autopilot !== "off" && existing.autopilot === "off";
    if (switchedOn) {
      rescuePendingGoals(req.params.id);

      // Start queue if there are existing todo tasks waiting to run
      const existingTodo = db.prepare(
        "SELECT COUNT(*) as cnt FROM tasks WHERE project_id = ? AND status = 'todo' AND assignee_id IS NOT NULL",
      ).get(req.params.id) as { cnt: number };

      if (existingTodo.cnt > 0 && ctx.scheduler) {
        if (!ctx.scheduler.isRunning(req.params.id)) {
          ctx.scheduler.startQueue(req.params.id);
          log.info(`Autopilot on: started queue for ${existingTodo.cnt} existing todo task(s)`);
        }
        db.prepare(
          "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot', ?)",
        ).run(
          req.params.id,
          `자동 실행 시작 — 대기 중인 태스크 ${existingTodo.cnt}개를 자동으로 진행합니다`,
        );
        broadcast("project:updated", { projectId: req.params.id });
      }
    }

    // Autopilot goal/full → off: stop the queue. Previously the PATCH only
    // updated the DB row and broadcast, leaving the scheduler poll loop
    // running in the background. The next poll would still pick `todo`
    // tasks, spawn architect, and the user would see "에이전트가 자꾸
    // 작업하려고 한다" despite manual mode being on. Also clear ghost
    // working agents whose runtime context is gone — without this they
    // get stuck on the dashboard as "working" forever.
    const switchedOff =
      autopilot === "off" && existing.autopilot && existing.autopilot !== "off";
    if (switchedOff) {
      if (ctx.scheduler) {
        try { ctx.scheduler.stopQueue(req.params.id); } catch { /* best-effort */ }
      }
      // 진행 중이던 task를 todo로 되돌려 다음 수동 실행 시 깨끗한 상태에서
      // 시작. 비파괴(retry_count 유지)로 둠.
      db.prepare(
        "UPDATE tasks SET status = 'todo', updated_at = datetime('now') WHERE project_id = ? AND status IN ('in_progress', 'in_review')",
      ).run(req.params.id);
      // Working 상태 ghost agent 정리.
      db.prepare(
        "UPDATE agents SET status = 'idle', current_task_id = NULL, current_activity = NULL WHERE project_id = ? AND status = 'working'",
      ).run(req.params.id);
      db.prepare(
        "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_off', ?)",
      ).run(
        req.params.id,
        `수동 모드로 전환 — 큐 정지, 진행 중 작업 todo로 되돌림`,
      );
      broadcast("queue:stopped", { projectId: req.params.id });
      broadcast("project:updated", { projectId: req.params.id });
      log.info(`Autopilot off: queue stopped + ghost state cleaned for ${req.params.id}`);
    }
  });

  /**
   * Kick spec generation + decompose for any goal in this project that has
   * progress=0 AND no tasks yet. Runs async; errors are logged and surfaced
   * as activity rows so the dashboard can show them.
   */
  function rescuePendingGoals(projectId: string): void {
    const pending = db.prepare(`
      SELECT g.id, g.title, gs.id AS spec_id,
             COALESCE(json_extract(gs.prd_summary, '$._status'), '') AS spec_status
      FROM goals g
      LEFT JOIN goal_specs gs ON gs.goal_id = g.id
      WHERE g.project_id = ?
        AND g.progress = 0
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.goal_id = g.id)
    `).all(projectId) as Array<{
      id: string;
      title: string;
      spec_id: string | null;
      spec_status: string;
    }>;

    if (pending.length === 0) return;

    log.info(
      `Autopilot enabled: rescuing ${pending.length} pending goal(s) for project ${projectId}`,
    );
    db.prepare(
      "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_rescue', ?)",
    ).run(
      projectId,
      `Autopilot 전환 감지 — 대기 중인 목표 ${pending.length}개에 대해 기획서/작업 분할 재개`,
    );
    broadcast("project:updated", { projectId });

    for (const g of pending) {
      // Case 1: spec missing or failed → generate spec, then decompose
      const needSpec = !g.spec_id || g.spec_status === "failed";
      // Case 2: spec still generating → leave alone, it will trigger
      // decompose itself when the in-flight generation completes
      const stillGenerating = g.spec_status === "generating";

      if (stillGenerating) {
        log.info(`Rescue skipping goal ${g.id} — spec still generating`);
        continue;
      }

      if (needSpec) {
        if (!ctx.generateGoalSpec) {
          log.warn(`Rescue cannot run: generateGoalSpec not wired yet for goal ${g.id}`);
          continue;
        }
        // Placeholder spec row so UI reflects progress
        db.prepare(
          `INSERT OR REPLACE INTO goal_specs
             (goal_id, prd_summary, feature_specs, user_flow, acceptance_criteria, tech_considerations, generated_by)
           VALUES (?, '{"_status":"generating"}', '[]', '[]', '[]', '[]', 'ai')`,
        ).run(g.id);
        broadcast("project:updated", { projectId });

        ctx.generateGoalSpec(g.id)
          .then(() => {
            log.info(`Rescue: spec generated for goal ${g.id}, triggering decompose`);
            broadcast("project:updated", { projectId });
            if (ctx.orchestrationEngine) {
              ctx.orchestrationEngine.decomposeGoal(g.id).catch((err: any) => {
                log.error(`Rescue decompose failed for goal ${g.id}`, err);
                db.prepare(
                  "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_warning', ?)",
                ).run(
                  projectId,
                  `작업 분할 실패 (${g.title}): ${String(err?.message ?? err).slice(0, 160)}`,
                );
                broadcast("project:updated", { projectId });
              });
            }
          })
          .catch((err: any) => {
            log.error(`Rescue spec generation failed for goal ${g.id}`, err);
            const errorMsg = String(err?.message ?? err).slice(0, 200).replace(/"/g, "'");
            db.prepare(
              "UPDATE goal_specs SET prd_summary = ?, updated_at = datetime('now') WHERE goal_id = ?",
            ).run(
              JSON.stringify({ _status: "failed", _error: errorMsg }),
              g.id,
            );
            broadcast("project:updated", { projectId });
          });
      } else {
        // Case 3: spec already complete → go straight to decompose
        if (!ctx.orchestrationEngine) {
          log.warn(`Rescue cannot run: orchestrationEngine not wired yet for goal ${g.id}`);
          continue;
        }
        log.info(`Rescue: spec already exists for goal ${g.id}, triggering decompose directly`);
        ctx.orchestrationEngine.decomposeGoal(g.id).catch((err: any) => {
          log.error(`Rescue decompose failed for goal ${g.id}`, err);
          db.prepare(
            "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_warning', ?)",
          ).run(
            projectId,
            `작업 분할 실패 (${g.title}): ${String(err?.message ?? err).slice(0, 160)}`,
          );
          broadcast("project:updated", { projectId });
        });
      }
    }
  }

  // ─── Agent branch management ───────────────────────────

  /** List unmerged agent/* branches for a project */
  router.get("/:id/branches", (req, res) => {
    const project = db.prepare("SELECT workdir FROM projects WHERE id = ?").get(req.params.id) as { workdir: string } | undefined;
    if (!project?.workdir) return res.status(404).json({ error: "Project not found or no workdir" });

    // spawnSync imported at top level
    const result = spawnSync("git", ["branch", "--list", "agent/*"], {
      cwd: project.workdir, stdio: "pipe", timeout: 10_000, encoding: "utf-8",
    });
    if (result.status !== 0) return res.json({ branches: [] });

    const branches = result.stdout.split("\n")
      .map((b: string) => b.replace(/^\*?\s*/, "").trim())
      .filter((b: string) => b && b.startsWith("agent/"));

    res.json({ branches });
  });

  /**
   * Merge all agent branches via AI agent.
   * Agent resolves conflicts intelligently instead of failing on git merge.
   * Flow: find suitable agent → send merge prompt → agent resolves & commits.
   */
  router.post("/:id/branches/merge-all", async (req, res) => {
    const projectId = req.params.id;
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
    if (!project?.workdir) return res.status(404).json({ error: "Project not found or no workdir" });

    const { getDefaultBranch } = await import("../../core/project/git-workflow.js");
    const targetBranch = getDefaultBranch(project.workdir);

    // List agent branches
    const listResult = spawnSync("git", ["branch", "--list", "agent/*"], {
      cwd: project.workdir, stdio: "pipe", timeout: 10_000, encoding: "utf-8",
    });
    if (listResult.status !== 0) return res.json({ status: "error", error: "Failed to list branches" });

    const branches = listResult.stdout.split("\n")
      .map((b: string) => b.replace(/^\*?\s*/, "").trim())
      .filter((b: string) => b && b.startsWith("agent/"));

    if (branches.length === 0) return res.json({ status: "no_branches" });

    // Find best agent: CTO > any idle coder/backend/frontend > first idle agent
    const agents = db.prepare(
      "SELECT id, name, role, status FROM agents WHERE project_id = ? ORDER BY CASE role WHEN 'cto' THEN 0 WHEN 'backend' THEN 1 WHEN 'frontend' THEN 2 WHEN 'coder' THEN 3 ELSE 9 END"
    ).all(projectId) as any[];

    const agent = agents.find((a: any) => a.status === "idle")
      ?? agents.find((a: any) => a.status !== "working");
    if (!agent) return res.status(409).json({ error: "No available agent — all agents are busy" });

    // Build merge prompt
    const branchList = branches.map(b => `  - ${b}`).join("\n");
    const mergePrompt = `# Branch Merge Task

다음 에이전트 브랜치들을 \`${targetBranch}\` 브랜치에 합쳐주세요.

## 브랜치 목록
${branchList}

## 작업 순서
1. 현재 \`${targetBranch}\` 브랜치로 checkout
2. 각 브랜치를 하나씩 merge (--no-ff):
   - 충돌이 없으면 그대로 진행
   - **충돌이 발생하면**: 양쪽 코드를 읽고 의미를 이해한 뒤 올바르게 해결. 두 변경사항을 모두 살리는 방향으로 합치되, 중복이나 문법 오류가 없도록 주의
3. 각 merge 완료 후 해당 브랜치 삭제 (\`git branch -d <branch>\`)
4. 모든 merge 완료 후 최종 상태 확인 (\`git log --oneline -10\`)

## 주의사항
- 절대 코드를 임의로 삭제하지 마세요. 두 브랜치의 변경사항을 모두 보존하세요.
- merge commit 메시지는 \`chore: merge agent branches into ${targetBranch}\` 형식으로.
- push하지 마세요 (로컬 merge만).
- 작업 완료 후 남은 agent/* 브랜치가 없는지 확인하세요.`;

    // Return immediately — run asynchronously via agent
    res.json({ status: "started", agentId: agent.id, agentName: agent.name, branches });

    // Async: spawn agent and execute merge
    const sm = ctx.sessionManager;
    if (!sm) {
      log.error("sessionManager not initialized — cannot merge branches");
      return;
    }
    (async () => {
      db.prepare("UPDATE agents SET status = 'working', current_activity = 'branch_merge' WHERE id = ?").run(agent.id);
      broadcast("agent:status", { id: agent.id, name: agent.name, status: "working", activity: "branch_merge" });
      broadcast("project:branch-merge-started", { projectId, agentId: agent.id, agentName: agent.name, branches });

      let session;
      try {
        session = sm.spawnAgent(agent.id, project.workdir);
        session.on("output", (text: string) => {
          broadcast("agent:output", { agentId: agent.id, output: text });
        });

        const result = await session.send(mergePrompt);
        const { parseStreamJson } = await import("../../core/agent/adapters/stream-parser.js");
        const parsed = parseStreamJson(result.stdout);

        // Check remaining branches after merge
        const afterResult = spawnSync("git", ["branch", "--list", "agent/*"], {
          cwd: project.workdir, stdio: "pipe", timeout: 10_000, encoding: "utf-8",
        });
        const remaining = (afterResult.stdout?.toString() ?? "").split("\n")
          .map((b: string) => b.replace(/^\*?\s*/, "").trim())
          .filter((b: string) => b && b.startsWith("agent/"));

        const mergedCount = branches.length - remaining.length;

        broadcast("project:branch-merge-complete", {
          projectId,
          agentId: agent.id,
          merged: mergedCount,
          remaining,
          summary: parsed.text?.slice(0, 500) || "",
        });

        db.prepare(
          "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'branch_merge', ?)",
        ).run(projectId, agent.id,
          `Merged ${mergedCount}/${branches.length} agent branches into ${targetBranch}${remaining.length > 0 ? ` (${remaining.length} remaining)` : ""}`);

      } catch (err: any) {
        broadcast("project:branch-merge-complete", {
          projectId, agentId: agent.id, error: err.message, merged: 0, remaining: branches,
        });
      } finally {
        // finally must never throw — wrap each side-effect so a single failure
        // doesn't become an unhandled rejection
        try { sm.killSession(agent.id); } catch (e: any) { log.warn(`merge cleanup: killSession failed — ${e?.message ?? e}`); }
        try {
          db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?").run(agent.id);
        } catch (e: any) { log.warn(`merge cleanup: agent status reset failed — ${e?.message ?? e}`); }
        try { broadcast("agent:status", { id: agent.id, name: agent.name, status: "idle" }); } catch { /* ignore */ }
      }
    })().catch((err: any) => {
      // Defense-in-depth: catch anything the try/catch missed so Node never
      // sees an unhandled promise rejection from this IIFE.
      log.error(`merge-all IIFE crashed unexpectedly: ${err?.message ?? err}`);
    });
  });

  /** Delete all agent branches (force) */
  router.delete("/:id/branches", (req, res) => {
    const project = db.prepare("SELECT workdir FROM projects WHERE id = ?").get(req.params.id) as { workdir: string } | undefined;
    if (!project?.workdir) return res.status(404).json({ error: "Project not found or no workdir" });

    // spawnSync imported at top level
    const listResult = spawnSync("git", ["branch", "--list", "agent/*"], {
      cwd: project.workdir, stdio: "pipe", timeout: 10_000, encoding: "utf-8",
    });
    if (listResult.status !== 0) return res.json({ deleted: [] });

    const branches = listResult.stdout.split("\n")
      .map((b: string) => b.replace(/^\*?\s*/, "").trim())
      .filter((b: string) => b && b.startsWith("agent/"));

    const deleted: string[] = [];
    for (const branch of branches) {
      const r = spawnSync("git", ["branch", "-D", branch], { cwd: project.workdir, stdio: "pipe", timeout: 5_000 });
      if (r.status === 0) deleted.push(branch);
    }

    broadcast("project:branches-deleted", { projectId: req.params.id, deleted });
    res.json({ deleted });
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

      // Create project — auto-fill mission from CLAUDE.md/readme if available
      const result = db.prepare(`
        INSERT INTO projects (name, mission, source, workdir, tech_stack)
        VALUES (?, ?, 'local_import', ?, ?)
      `).run(projectName, analysis.mission || "", resolvedImport, JSON.stringify(analysis.techStack));

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

  // List project docs (.md files in docs/, plans, references, etc.)
  router.get("/:id/docs", (req, res) => {
    const project = db.prepare("SELECT workdir FROM projects WHERE id = ?").get(req.params.id) as { workdir: string } | undefined;
    if (!project || !project.workdir) return res.status(404).json({ error: "Project not found or no workdir" });

    const docs: Array<{ path: string; name: string; dir: string }> = [];
    const scanDirs = ["docs", "docs/plans", "docs/references", "docs/reviews", "docs/designs"];

    for (const dir of scanDirs) {
      const fullDir = join(project.workdir, dir);
      try {
        const stat = statSync(fullDir);
        if (!stat.isDirectory()) continue;
        const files = readdirSync(fullDir, { withFileTypes: true });
        for (const f of files) {
          if (!f.isFile()) continue;
          if (!f.name.endsWith(".md") && !f.name.endsWith(".yaml") && !f.name.endsWith(".yml")) continue;
          const relPath = `${dir}/${f.name}`;
          // Avoid duplicates (docs/plans/x.md seen from both "docs" and "docs/plans")
          if (!docs.some((d) => d.path === relPath)) {
            docs.push({ path: relPath, name: f.name, dir });
          }
        }
      } catch { /* skip non-existent dirs */ }
    }

    // Also scan root-level important files (dedup by lowercase)
    const seenRoot = new Set<string>();
    for (const rootFile of ["CLAUDE.md", "README.md", "readme.md"]) {
      if (seenRoot.has(rootFile.toLowerCase())) continue;
      try {
        statSync(join(project.workdir, rootFile));
        docs.push({ path: rootFile, name: rootFile, dir: "" });
        seenRoot.add(rootFile.toLowerCase());
      } catch { /* skip */ }
    }

    res.json(docs);
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

      // Create project — auto-fill mission from CLAUDE.md/readme if available
      const dbResult = db.prepare(`
        INSERT INTO projects (name, mission, source, workdir, github_config, tech_stack)
        VALUES (?, ?, 'github', ?, ?, ?)
      `).run(
        projectName,
        result.analysis.mission || "",
        validatedPath,
        JSON.stringify({ repoUrl: result.repoUrl, branch: result.branch, autoPush: false, prMode: true }),
        JSON.stringify(result.analysis.techStack),
      );

      const project = toProjectResponse(db.prepare("SELECT * FROM projects WHERE rowid = ?").get(dbResult.lastInsertRowid));

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

  // Delete project — stop scheduler queue + dev server before CASCADE delete
  router.delete("/:id", (req, res) => {
    const projectId = req.params.id;
    // Stop scheduler queue first to prevent accessing deleted resources
    ctx.scheduler?.stopQueue(projectId);
    // Kill any running agent sessions for this project
    const agents = db.prepare("SELECT id FROM agents WHERE project_id = ?").all(projectId) as { id: string }[];
    for (const a of agents) {
      ctx.sessionManager?.killSession(a.id);
    }
    const result = db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    if (result.changes === 0) return res.status(404).json({ error: "Project not found" });
    ctx.devServerManager.stop(projectId);
    broadcast("project:updated", { id: projectId, deleted: true });
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
      // 요청 body에 port가 있으면 우선, 없으면 프로젝트 설정의 dev_port, 없으면 자동 할당
      const preferredPort = req.body?.port ?? project.dev_port ?? undefined;
      const force = req.body?.force ?? false;
      const { port, url } = await ctx.devServerManager.start(
        req.params.id, project.workdir, { port: preferredPort, force },
      );
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
  /** Wait for all tasks in a goal to settle (done or permanently blocked) */
  function waitForGoalCompletion(goalId: string, projectId: string): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        // User may have switched mode — bail out
        const current = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(projectId) as any;
        if (current?.autopilot !== "full") { resolve(); return; }

        const goal = db.prepare("SELECT progress FROM goals WHERE id = ?").get(goalId) as any;
        if (!goal || goal.progress >= 100) { resolve(); return; }

        // All tasks done or permanently blocked → goal is settled
        const stats = db.prepare(`
          SELECT COUNT(*) as total,
                 SUM(CASE WHEN status IN ('done', 'blocked') THEN 1 ELSE 0 END) as settled
          FROM tasks WHERE goal_id = ? AND parent_task_id IS NULL
        `).get(goalId) as { total: number; settled: number };
        if (stats.total > 0 && stats.settled >= stats.total) { resolve(); return; }

        setTimeout(check, 5000);
      };
      check();
    });
  }

  async function triggerFullAutopilot(projectId: string) {
    if (!ctx.orchestrationEngine || !ctx.scheduler) {
      log.warn("Full autopilot trigger skipped: orchestration not initialized");
      return;
    }

    try {
      log.info(`Full autopilot started for project ${projectId}`);
      broadcast("autopilot:full-status", {
        projectId, phase: "generating_goals", currentGoalIndex: 0, totalGoals: 0,
        message: "CTO가 미션을 분석하고 목표를 생성합니다...",
      });

      // Step 1: CTO generates goals from mission (all at once for roadmap context)
      const { goalIds } = await ctx.orchestrationEngine.generateGoalsFromMission(projectId);

      if (goalIds.length === 0) {
        log.warn("Full autopilot: no goals generated, downgrading to goal mode");
        db.prepare("UPDATE projects SET autopilot = 'goal', updated_at = datetime('now') WHERE id = ?").run(projectId);
        broadcast("autopilot:full-status", { projectId, phase: "completed", message: "생성할 목표가 없습니다" });
        broadcast("autopilot:full-completed", { projectId, reason: "no_goals" });
        broadcast("autopilot:mode-changed", { projectId, mode: "goal" });
        return;
      }

      // Step 2: Sequential pipeline — decompose → execute → wait → next goal
      for (let i = 0; i < goalIds.length; i++) {
        const goalId = goalIds[i];

        // Guard: re-check autopilot mode (user may have switched mid-run)
        const current = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(projectId) as any;
        if (current?.autopilot !== "full") {
          log.info("Full autopilot: mode changed during execution, stopping");
          broadcast("autopilot:full-status", { projectId, phase: "completed", message: "사용자가 모드를 변경했습니다" });
          return;
        }

        const goal = db.prepare("SELECT title, description FROM goals WHERE id = ?").get(goalId) as any;
        const goalTitle = (goal?.title || goal?.description || "").slice(0, 50);

        try {
          // 2a: Decompose this goal
          broadcast("autopilot:full-status", {
            projectId, phase: "decomposing", currentGoalIndex: i + 1, totalGoals: goalIds.length,
            goalId, message: `Goal ${i + 1}/${goalIds.length} 분해 중: "${goalTitle}"`,
          });
          await ctx.orchestrationEngine.decomposeGoal(goalId);

          // 2b: Auto-approve tasks for this goal
          const approved = db.prepare(
            "UPDATE tasks SET status = 'todo' WHERE goal_id = ? AND status = 'pending_approval'"
          ).run(goalId);
          log.info(`Full autopilot: auto-approved ${approved.changes} tasks for goal ${i + 1}/${goalIds.length}`);

          // 2c: Start queue (if not running)
          if (ctx.scheduler && !ctx.scheduler.isRunning(projectId)) {
            ctx.scheduler.startQueue(projectId);
          }

          // 2d: Wait for this goal to complete before moving to next
          broadcast("autopilot:full-status", {
            projectId, phase: "executing", currentGoalIndex: i + 1, totalGoals: goalIds.length,
            goalId, message: `Goal ${i + 1}/${goalIds.length} 실행 중: "${goalTitle}"`,
          });
          await waitForGoalCompletion(goalId, projectId);

          log.info(`Full autopilot: goal ${i + 1}/${goalIds.length} completed`);
        } catch (err: any) {
          log.error(`Full autopilot: failed on goal ${i + 1}/${goalIds.length}`, err);
          broadcast("autopilot:full-status", {
            projectId, phase: "error", currentGoalIndex: i + 1, totalGoals: goalIds.length,
            goalId, message: `Goal ${i + 1} 실패: ${err.message?.slice(0, 100)}`,
          });
          // Continue with next goal — don't let one failure block all
        }
      }

      // Step 3: Downgrade to 'goal' mode after all goals processed
      db.prepare("UPDATE projects SET autopilot = 'goal', updated_at = datetime('now') WHERE id = ?").run(projectId);
      broadcast("autopilot:full-status", {
        projectId, phase: "completed", currentGoalIndex: goalIds.length, totalGoals: goalIds.length,
        message: `${goalIds.length}개 목표 처리 완료`,
      });
      broadcast("autopilot:full-completed", { projectId, reason: "goals_generated", goalCount: goalIds.length });
      broadcast("autopilot:mode-changed", { projectId, mode: "goal" });
      broadcast("project:updated", { projectId });

      log.info(`Full autopilot completed: ${goalIds.length} goals processed sequentially, downgraded to goal mode`);
    } catch (err: any) {
      log.error(`Full autopilot failed for project ${projectId}`, err);

      // Safety: downgrade to goal mode on failure
      db.prepare("UPDATE projects SET autopilot = 'goal', updated_at = datetime('now') WHERE id = ?").run(projectId);
      broadcast("autopilot:full-status", { projectId, phase: "error", message: `실패: ${err.message?.slice(0, 100)}` });
      broadcast("autopilot:full-completed", { projectId, reason: "error", error: err.message });
      broadcast("autopilot:mode-changed", { projectId, mode: "goal" });

      db.prepare(
        "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_error', ?)",
      ).run(projectId, `Full autopilot failed: ${err.message?.slice(0, 200)}`);
    }
  }

  return router;
}
