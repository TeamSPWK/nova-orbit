import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDatabase, migrate } from "./db/schema.js";
import { recoverOnStartup } from "./core/recovery.js";
import { createProjectRoutes } from "./api/routes/projects.js";
import { createAgentRoutes } from "./api/routes/agents.js";
import { createTaskRoutes } from "./api/routes/tasks.js";
import { createVerificationRoutes } from "./api/routes/verification.js";
import { createGoalRoutes } from "./api/routes/goals.js";
import { createOrchestrationRoutes } from "./api/routes/orchestration.js";
import { createActivityRoutes } from "./api/routes/activities.js";
import { createFsRoutes } from "./api/routes/fs.js";
import { createWSHandler } from "./api/websocket.js";
import { createDevServerManager, type DevServerManager } from "./core/project/dev-server.js";
import { loadOrCreateApiKey, authMiddleware } from "./api/middleware/auth.js";
import type { Database } from "better-sqlite3";
import type { SessionManager } from "./core/agent/session.js";
import type { Scheduler } from "./core/orchestration/scheduler.js";

export interface ServerConfig {
  port: number;
  dataDir: string;
}

export interface AppContext {
  db: Database;
  wss: WebSocketServer;
  broadcast: (event: string, data: unknown) => void;
  sessionManager?: SessionManager;
  devServerManager: DevServerManager;
  // Set by orchestration routes, used by goals/projects autopilot triggers
  orchestrationEngine?: {
    decomposeGoal: (goalId: string) => Promise<{ taskCount: number; projectId: string }>;
    generateGoalsFromMission: (projectId: string) => Promise<{ goalIds: string[] }>;
    executeTask: (taskId: string, config?: any) => Promise<{ success: boolean; verdict: string }>;
  };
  generateGoalSpec?: (goalId: string) => Promise<any>;
  scheduler?: Scheduler;
}

export async function startServer(config: ServerConfig): Promise<void> {
  const { port, dataDir } = config;

  // Ensure data directory exists
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dataDir, { recursive: true });

  // Initialize database
  const dbPath = resolve(dataDir, "nova-orbit.db");
  const db = createDatabase(dbPath);
  migrate(db);
  console.log(`  Database: ${dbPath}`);

  const recovery = recoverOnStartup(db);
  if (recovery.recoveredTasks > 0 || recovery.killedProcesses > 0) {
    console.log(`  Recovery: ${recovery.recoveredTasks} tasks restored, ${recovery.killedProcesses} orphan processes killed`);
  }

  // Express app
  const app = express();
  app.use(express.json());

  // CORS for dashboard dev server — localhost origins only
  // CORS: 대시보드 dev (5173) + 서버 자체 (동적 포트)
  const ALLOWED_ORIGINS = [
    "http://localhost:5173",
    `http://localhost:${port}`,
    "http://127.0.0.1:5173",
    `http://127.0.0.1:${port}`,
  ];
  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // API authentication
  const apiKey = loadOrCreateApiKey(dataDir);
  app.use(authMiddleware(apiKey));

  // HTTP + WebSocket server
  const server = createServer(app);
  // 연결을 항상 수락하되, 인증 여부를 태깅 — proxy EPIPE 방지
  const wss = new WebSocketServer({ server, path: "/ws" });

  const broadcast = (event: string, data: unknown) => {
    const message = JSON.stringify({ type: event, payload: data, timestamp: new Date().toISOString() });
    for (const client of wss.clients) {
      if (client.readyState === 1 && (client as any).__authenticated) {
        try { client.send(message); } catch { /* skip dead client */ }
      }
    }
  };

  const devServerManager = createDevServerManager(port);
  const ctx: AppContext = { db, wss, broadcast, devServerManager };

  // WebSocket handler
  createWSHandler(wss, apiKey);

  // API routes
  app.use("/api/projects", createProjectRoutes(ctx));
  app.use("/api/agents", createAgentRoutes(ctx));
  app.use("/api/goals", createGoalRoutes(ctx));
  app.use("/api/tasks", createTaskRoutes(ctx));
  app.use("/api/verifications", createVerificationRoutes(ctx));
  app.use("/api/orchestration", createOrchestrationRoutes(ctx));
  app.use("/api/activities", createActivityRoutes(ctx));
  app.use("/api/fs", createFsRoutes());

  // Health check
  app.get("/api/health", (_req, res) => {
    let version = "unknown";
    try {
      const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
      version = JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    } catch { /* fallback */ }
    res.json({ status: "ok", version });
  });

  // Nova Rules version + sync status
  app.get("/api/nova-rules/version", (_req, res) => {
    try {
      // Try multiple paths for version.json (dev vs dist)
      const candidates = [
        resolve(dirname(fileURLToPath(import.meta.url)), "core", "nova-rules", "version.json"),
        resolve(process.cwd(), "server", "core", "nova-rules", "version.json"),
        resolve(process.cwd(), "dist", "server", "core", "nova-rules", "version.json"),
      ];
      const versionPath = candidates.find((p) => existsSync(p));
      if (!versionPath) {
        return res.json({ synced: false, novaCommit: null, syncedAt: null, latestCommit: null, needsUpdate: false });
      }
      const version = JSON.parse(readFileSync(versionPath, "utf-8"));

      // Check if Nova source is available and has a newer version
      let latestVersion: string | null = null;
      let latestCommit: string | null = null;
      let needsUpdate = false;
      try {
        const novaCandidates = [
          resolve(process.cwd(), "..", "nova"),
          resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "nova"),
        ];
        const novaDir = novaCandidates.find((p) => existsSync(resolve(p, ".git"))) ?? novaCandidates[0];

        // Read release version
        const novaVersionFile = resolve(novaDir, "scripts", ".nova-version");
        if (existsSync(novaVersionFile)) {
          latestVersion = readFileSync(novaVersionFile, "utf-8").trim();
        }

        const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: novaDir, encoding: "utf-8", timeout: 3000 });
        if (result.status === 0) {
          latestCommit = result.stdout.trim();
        }

        // Compare by version first, fallback to commit
        needsUpdate = latestVersion
          ? latestVersion !== version.novaVersion
          : (latestCommit !== null && latestCommit !== version.novaCommit);
      } catch { /* Nova dir not available */ }

      res.json({ synced: true, ...version, latestVersion, latestCommit, needsUpdate });
    } catch {
      res.json({ synced: false, novaCommit: null, syncedAt: null, latestCommit: null, needsUpdate: false });
    }
  });

  // Nova Rules sync trigger (POST)
  app.post("/api/nova-rules/sync", (_req, res) => {
    try {
      const scriptPath = resolve(process.cwd(), "scripts", "sync-nova-rules.sh");
      const result = spawnSync("bash", [scriptPath], { encoding: "utf-8", timeout: 10000 });
      if (result.status === 0) {
        // Re-read version after sync (try multiple paths)
        const vCandidates = [
          resolve(process.cwd(), "server", "core", "nova-rules", "version.json"),
          resolve(process.cwd(), "dist", "server", "core", "nova-rules", "version.json"),
          resolve(dirname(fileURLToPath(import.meta.url)), "core", "nova-rules", "version.json"),
        ];
        const vPath = vCandidates.find((p) => existsSync(p));
        const version = vPath ? JSON.parse(readFileSync(vPath, "utf-8")) : null;
        res.json({ success: true, message: result.stdout.trim(), version });
      } else {
        res.status(500).json({ success: false, message: result.stderr || "Sync failed" });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Claude Code status — read from ~/.claude/tmux-status (written by statusline.sh)
  const claudeStatusPath = resolve(process.env.HOME ?? "", ".claude", "tmux-status");
  app.get("/api/claude-status", (_req, res) => {
    try {
      const raw = readFileSync(claudeStatusPath, "utf-8").trim();
      const stat = statSync(claudeStatusPath);
      // Parse: " Opus 4.6 (1M context) │ ctx:8% │ ↑6K ↓24K │ $1.87 │ 5h:8%"
      const tokenMatch = raw.match(/↑(\d+)K\s*↓(\d+)K/);
      const costMatch = raw.match(/\$([0-9.]+)/);
      const rateMatch = raw.match(/5h:(\d+)%/);
      const modelMatch = raw.match(/^\s*(.+?)\s*│/);
      res.json({
        raw,
        model: modelMatch?.[1]?.trim() ?? null,
        inputTokensK: tokenMatch ? Number(tokenMatch[1]) : null,
        outputTokensK: tokenMatch ? Number(tokenMatch[2]) : null,
        costUsd: costMatch ? Number(costMatch[1]) : null,
        ratePercent: rateMatch ? Number(rateMatch[1]) : null,
        updatedAt: stat.mtime.toISOString(),
      });
    } catch {
      res.json({ raw: null, error: "Claude status unavailable" });
    }
  });

  // Serve dashboard (production build)
  // In dev: ../dashboard/dist, in built: ../dashboard (copied by build:dashboard)
  const serverDir = import.meta.dirname ?? __dirname;
  const dashboardPaths = [
    resolve(serverDir, "../dashboard"),       // built (dist/dashboard/)
    resolve(serverDir, "../dashboard/dist"),   // dev fallback
  ];
  const dashboardDist = dashboardPaths.find((p) => {
    try { return existsSync(resolve(p, "index.html")); } catch { return false; }
  }) ?? dashboardPaths[0];

  app.use(express.static(dashboardDist));
  app.get("/{*splat}", (_req, res) => {
    const indexPath = resolve(dashboardDist, "index.html");
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: "Dashboard not built. Run: npm run build:dashboard" });
    }
  });

  // Bind to localhost only by default (security: prevent network exposure)
  const host = process.env.NOVA_ORBIT_HOST ?? "127.0.0.1";
  server.listen(port, host, () => {
    console.log(`  Server listening on ${host}:${port}`);

    // Auto-resume queues for autopilot projects after startup
    if (ctx.scheduler) {
      const autopilotProjects = db.prepare(
        "SELECT id, name, autopilot FROM projects WHERE status = 'active' AND autopilot != 'off'",
      ).all() as { id: string; name: string; autopilot: string }[];

      for (const p of autopilotProjects) {
        if (!ctx.scheduler.isRunning(p.id)) {
          console.log(`  Auto-starting queue for autopilot project "${p.name}" (mode: ${p.autopilot})`);
          ctx.scheduler.startQueue(p.id);
        }
      }
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n  Shutting down gracefully...");

    // 1. 실행 중인 에이전트 세션 종료
    if (ctx.sessionManager) {
      ctx.sessionManager.killAll();
    }

    // 2. 스케줄러 정지: 모든 active 프로젝트 큐 중단
    if (ctx.scheduler) {
      const projects = db.prepare("SELECT id FROM projects WHERE status = 'active'").all() as { id: string }[];
      for (const p of projects) ctx.scheduler.stopQueue(p.id);
    }

    // 3. Dev server 정리
    devServerManager.stopAll();

    // 4. WebSocket / HTTP 종료
    wss.close();
    server.close();

    // 5. DB 정리: active 세션 → killed, DB 닫기
    db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE status = 'active'").run();
    db.close();

    process.exit(0);
  };

  // 5초 timeout 후 강제 종료 (shutdown이 hang하는 경우 대비)
  process.on("SIGINT", () => { shutdown().finally(() => setTimeout(() => process.exit(1), 5000)); });
  process.on("SIGTERM", () => { shutdown().finally(() => setTimeout(() => process.exit(1), 5000)); });

  // Prevent server crash on unhandled errors
  process.on("uncaughtException", (err) => {
    console.error("[FATAL] Uncaught exception (server kept alive):", err.message);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[FATAL] Unhandled rejection (server kept alive):", reason);
  });
}

// Auto-start when run directly (dev mode: tsx watch server/index.ts)
const isDirectRun = process.argv[1]?.endsWith("server/index.ts") ||
                    process.argv[1]?.endsWith("server/index.js");
if (isDirectRun) {
  const port = parseInt(process.env.PORT || "7200", 10);
  const dataDir = resolve(process.cwd(), process.env.NOVA_ORBIT_DATA_DIR || ".nova-orbit");
  startServer({ port, dataDir }).catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
