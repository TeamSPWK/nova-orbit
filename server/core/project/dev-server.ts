import { spawn, execSync, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("dev-server-manager");

const PORT_MIN = 4001;
const PORT_MAX = 4099;
// 기본 예약 포트 — createDevServerManager에서 실제 서버 포트를 추가
const BASE_RESERVED_PORTS = [5173]; // Vite dev

interface DevServerEntry {
  process: ChildProcess;
  port: number;
  pid: number;
  basePath: string;
}

/**
 * 프로젝트 workdir에서 프레임워크별 basePath를 자동 감지한다.
 * Next.js, Vite, Vue CLI, CRA(package.json homepage) 지원.
 */
function detectBasePath(workdir: string): string {
  // Next.js: next.config.{ts,js,mjs}
  for (const name of ["next.config.ts", "next.config.js", "next.config.mjs"]) {
    const fp = join(workdir, name);
    if (!existsSync(fp)) continue;
    try {
      const src = readFileSync(fp, "utf-8");
      const m = src.match(/basePath\s*:\s*["'`]([^"'`]+)["'`]/);
      if (m) return m[1];
    } catch { /* ignore */ }
  }

  // Vite: vite.config.{ts,js,mjs}
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mjs"]) {
    const fp = join(workdir, name);
    if (!existsSync(fp)) continue;
    try {
      const src = readFileSync(fp, "utf-8");
      const m = src.match(/\bbase\s*:\s*["'`]([^"'`]+)["'`]/);
      if (m && m[1] !== "/" && m[1] !== "./") return m[1].replace(/\/$/, "");
    } catch { /* ignore */ }
  }

  // Vue CLI: vue.config.{js,ts}
  for (const name of ["vue.config.js", "vue.config.ts"]) {
    const fp = join(workdir, name);
    if (!existsSync(fp)) continue;
    try {
      const src = readFileSync(fp, "utf-8");
      const m = src.match(/publicPath\s*:\s*["'`]([^"'`]+)["'`]/);
      if (m && m[1] !== "/" && m[1] !== "./") return m[1].replace(/\/$/, "");
    } catch { /* ignore */ }
  }

  // Angular: angular.json → baseHref
  const angularJson = join(workdir, "angular.json");
  if (existsSync(angularJson)) {
    try {
      const cfg = JSON.parse(readFileSync(angularJson, "utf-8"));
      const projects = cfg.projects ?? {};
      for (const proj of Object.values(projects) as any[]) {
        const baseHref = proj?.architect?.build?.options?.baseHref
          ?? proj?.architect?.serve?.options?.baseHref;
        if (baseHref && baseHref !== "/") return baseHref.replace(/\/$/, "");
      }
    } catch { /* ignore */ }
  }

  // CRA / generic: package.json homepage
  const pkgJson = join(workdir, "package.json");
  if (existsSync(pkgJson)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJson, "utf-8"));
      if (pkg.homepage && pkg.homepage !== "/" && pkg.homepage !== ".") {
        // homepage가 full URL이면 pathname만 추출
        try {
          const u = new URL(pkg.homepage);
          if (u.pathname && u.pathname !== "/") return u.pathname.replace(/\/$/, "");
        } catch {
          // relative path
          const hp = pkg.homepage.replace(/\/$/, "");
          if (hp && hp !== "." && hp !== "./") return hp.startsWith("/") ? hp : `/${hp}`;
        }
      }
    } catch { /* ignore */ }
  }

  return "";
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function validatePort(port: number, reservedPorts: Set<number>): string | null {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return `Invalid port ${port}. Must be between 1024 and 65535.`;
  }
  if (reservedPorts.has(port)) {
    return `Port ${port} is reserved by Nova Orbit.`;
  }
  return null;
}

/**
 * lsof로 포트를 점유하고 있는 PID를 찾아서 kill.
 * macOS/Linux 전용. 실패해도 예외를 던지지 않음.
 */
function forceKillPortHolder(port: number): boolean {
  try {
    const result = execSync(`lsof -ti :${port}`, { timeout: 5_000, encoding: "utf-8" }).trim();
    if (!result) return false;

    const pids = result.split("\n").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        log.info(`Sent SIGTERM to PID ${pid} holding port ${port}`);
      } catch { /* already gone */ }
    }

    // SIGTERM 후 잠깐 대기 — 동기적으로 500ms 재시도
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try {
        const check = execSync(`lsof -ti :${port}`, { timeout: 2_000, encoding: "utf-8" }).trim();
        if (!check) return true;
      } catch {
        return true; // lsof 실패 = 포트 해제됨
      }
      // busy-wait 50ms
      const until = Date.now() + 50;
      while (Date.now() < until) { /* spin */ }
    }

    // SIGTERM이 안 먹힌 프로세스에 SIGKILL
    for (const pid of pids) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
    log.warn(`Force-killed PIDs [${pids.join(",")}] holding port ${port}`);
    return true;
  } catch {
    // lsof 실패 (포트 점유자 없음 또는 명령 없음)
    return false;
  }
}

async function allocatePort(occupied: Set<number>): Promise<number> {
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    if (occupied.has(port)) continue;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port in range ${PORT_MIN}-${PORT_MAX}`);
}

function killWithFallback(proc: ChildProcess): void {
  if (proc.pid == null || proc.killed) return;
  try {
    process.kill(proc.pid, "SIGTERM");
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    if (!proc.killed && proc.pid != null) {
      try { process.kill(proc.pid, "SIGKILL"); } catch { /* already gone */ }
    }
  }, 5000);
  proc.once("exit", () => clearTimeout(timer));
}

export interface DevServerStatus {
  running: boolean;
  port: number | null;
  pid: number | null;
  url: string | null;
}

export interface DevServerManager {
  start(projectId: string, workdir: string, options?: { port?: number; force?: boolean }): Promise<{ port: number; url: string }>;
  stop(projectId: string): void;
  getStatus(projectId: string): DevServerStatus;
  stopAll(): void;
}

export function createDevServerManager(serverPort?: number): DevServerManager {
  const servers = new Map<string, DevServerEntry>();
  const reservedPorts = new Set([...BASE_RESERVED_PORTS, ...(serverPort ? [serverPort] : [7200])]);

  return {
    async start(projectId: string, workdir: string, options?: { port?: number; force?: boolean }) {
      const preferredPort = options?.port;
      const force = options?.force ?? false;

      // 같은 프로젝트의 기존 dev server 정리
      const existing = servers.get(projectId);
      if (existing) {
        killWithFallback(existing.process);
        servers.delete(projectId);
      }

      // 다른 프로젝트가 같은 포트를 쓰고 있으면 정리
      if (preferredPort) {
        for (const [otherId, entry] of servers) {
          if (entry.port === preferredPort && otherId !== projectId) {
            log.warn(`Port ${preferredPort} was used by project ${otherId} — stopping it`);
            killWithFallback(entry.process);
            servers.delete(otherId);
          }
        }
      }

      let port: number;
      if (preferredPort) {
        const err = validatePort(preferredPort, reservedPorts);
        if (err) throw new Error(err);

        if (await isPortAvailable(preferredPort)) {
          port = preferredPort;
        } else if (force) {
          // 강제 모드: 포트 점유 프로세스를 kill
          log.info(`Port ${preferredPort} occupied — force-killing holder`);
          forceKillPortHolder(preferredPort);

          // kill 후 재확인
          if (await isPortAvailable(preferredPort)) {
            port = preferredPort;
          } else {
            throw new Error(`Port ${preferredPort} is still in use after force-kill attempt`);
          }
        } else {
          throw new Error(`Port ${preferredPort} is already in use. Use force=true to kill the holder.`);
        }
      } else {
        const occupied = new Set(Array.from(servers.values()).map((e) => e.port));
        port = await allocatePort(occupied);
      }

      const proc = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
        cwd: workdir,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      // stdout/stderr를 drain — 읽지 않으면 OS 파이프 버퍼가 가득 차서 프로세스 블로킹
      proc.stdout?.resume();
      proc.stderr?.resume();

      proc.on("error", (err) => {
        log.warn(`Dev server for project ${projectId} error: ${err.message}`);
        servers.delete(projectId);
      });

      proc.on("exit", (code) => {
        log.info(`Dev server for project ${projectId} exited (code ${code})`);
        servers.delete(projectId);
      });

      if (proc.pid == null) {
        throw new Error("Failed to spawn dev server process");
      }

      const basePath = detectBasePath(workdir);
      servers.set(projectId, { process: proc, port, pid: proc.pid, basePath });
      log.info(`Started dev server for project ${projectId} on port ${port} (pid ${proc.pid})${basePath ? ` basePath=${basePath}` : ""}`);

      const url = `http://localhost:${port}${basePath}`;
      return { port, url };
    },

    stop(projectId: string) {
      const entry = servers.get(projectId);
      if (!entry) return;
      killWithFallback(entry.process);
      servers.delete(projectId);
      log.info(`Stopped dev server for project ${projectId}`);
    },

    getStatus(projectId: string): DevServerStatus {
      const entry = servers.get(projectId);
      if (!entry || entry.process.killed || entry.process.exitCode !== null) {
        servers.delete(projectId);
        return { running: false, port: null, pid: null, url: null };
      }
      return {
        running: true,
        port: entry.port,
        pid: entry.pid,
        url: `http://localhost:${entry.port}${entry.basePath}`,
      };
    },

    stopAll() {
      for (const [projectId, entry] of servers) {
        killWithFallback(entry.process);
        log.info(`Stopped dev server for project ${projectId} (shutdown)`);
      }
      servers.clear();
    },
  };
}
