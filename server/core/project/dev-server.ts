import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("dev-server-manager");

const PORT_MIN = 4001;
const PORT_MAX = 4099;

interface DevServerEntry {
  process: ChildProcess;
  port: number;
  pid: number;
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
  start(projectId: string, workdir: string): Promise<{ port: number; url: string }>;
  stop(projectId: string): void;
  getStatus(projectId: string): DevServerStatus;
  stopAll(): void;
}

export function createDevServerManager(): DevServerManager {
  const servers = new Map<string, DevServerEntry>();

  return {
    async start(projectId: string, workdir: string) {
      const existing = servers.get(projectId);
      if (existing) {
        killWithFallback(existing.process);
        servers.delete(projectId);
      }

      const occupied = new Set(Array.from(servers.values()).map((e) => e.port));
      const port = await allocatePort(occupied);

      const proc = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
        cwd: workdir,
        stdio: "pipe",
        detached: false,
      });

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

      servers.set(projectId, { process: proc, port, pid: proc.pid });
      log.info(`Started dev server for project ${projectId} on port ${port} (pid ${proc.pid})`);

      const url = `http://localhost:${port}`;
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
        url: `http://localhost:${entry.port}`,
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
