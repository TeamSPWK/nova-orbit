import type { Database } from "better-sqlite3";
import { createClaudeCodeAdapter, type ClaudeCodeSession } from "./adapters/claude-code.js";
import { createLogger } from "../../utils/logger.js";
import { resolvePrompt } from "./prompt-resolver.js";

const log = createLogger("session-manager");

export interface SessionManager {
  spawnAgent: (agentId: string, projectWorkdir: string) => ClaudeCodeSession;
  getSession: (agentId: string) => ClaudeCodeSession | undefined;
  killSession: (agentId: string) => void;
  killAll: () => void;
  pauseSession: (agentId: string) => void;
  resumeSession: (agentId: string) => void;
}

export function createSessionManager(db: Database): SessionManager {
  const sessions = new Map<string, ClaudeCodeSession>();
  const adapter = createClaudeCodeAdapter();

  return {
    spawnAgent(agentId: string, projectWorkdir: string): ClaudeCodeSession {
      // Cleanup existing session if any
      const existing = sessions.get(agentId);
      if (existing) {
        existing.cleanup();
      }

      // Get agent config from DB
      const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as any;
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      // Retrieve last session ID for resume (Paperclip pattern)
      const lastSession = db.prepare(
        "SELECT id FROM sessions WHERE agent_id = ? AND status = 'completed' ORDER BY ended_at DESC LIMIT 1",
      ).get(agentId) as any;

      const resolution = resolvePrompt(agent, projectWorkdir);
      log.info(`Spawned agent ${agent.role} (source: ${resolution.source}${resolution.filePath ? `, file: ${resolution.filePath}` : ""})`);

      const session = adapter.spawn({
        workdir: projectWorkdir,
        systemPrompt: resolution.prompt,
        sessionBehavior: agent.session_behavior || "resume-or-new",
        resumeSessionId: lastSession?.id ?? null,
        skillsDir: agent.skills_dir || undefined,
      });

      // Track session in DB
      db.prepare(`
        INSERT INTO sessions (agent_id, pid, status)
        VALUES (?, ?, 'active')
      `).run(agentId, null);

      // Listen for status changes
      session.on("status", (status: string) => {
        db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(
          status === "working" ? "working" : "idle",
          agentId,
        );
      });

      session.on("output", (text: string) => {
        // Store last output snippet
        db.prepare(`
          UPDATE sessions SET last_output = ? WHERE agent_id = ? AND status = 'active'
        `).run(text.slice(-500), agentId);
      });

      sessions.set(agentId, session);
      log.info(`Spawned session for agent ${agentId} (${agent.role})`);
      return session;
    },

    getSession(agentId: string): ClaudeCodeSession | undefined {
      return sessions.get(agentId);
    },

    killSession(agentId: string): void {
      const session = sessions.get(agentId);
      if (session) {
        session.removeAllListeners();
        session.cleanup();
        sessions.delete(agentId);
        db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE agent_id = ? AND status = 'active'")
          .run(agentId);
        db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?")
          .run(agentId);
        log.info(`Killed session for agent ${agentId}`);
      }
    },

    killAll(): void {
      for (const [agentId, session] of sessions) {
        session.removeAllListeners();
        session.cleanup();
        db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE agent_id = ? AND status = 'active'")
          .run(agentId);
        db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?")
          .run(agentId);
      }
      sessions.clear();
      log.info("Killed all sessions");
    },

    pauseSession(agentId: string): void {
      const session = sessions.get(agentId);
      if (!session?.process?.pid) {
        throw new Error(`No active session for agent ${agentId}`);
      }
      process.kill(session.process.pid, "SIGSTOP");
      db.prepare("UPDATE agents SET status = 'paused' WHERE id = ?").run(agentId);
      log.info(`Paused session for agent ${agentId} (pid ${session.process.pid})`);
    },

    resumeSession(agentId: string): void {
      const session = sessions.get(agentId);
      if (!session?.process?.pid) {
        throw new Error(`No active session for agent ${agentId}`);
      }
      process.kill(session.process.pid, "SIGCONT");
      db.prepare("UPDATE agents SET status = 'working' WHERE id = ?").run(agentId);
      log.info(`Resumed session for agent ${agentId} (pid ${session.process.pid})`);
    },
  };
}

