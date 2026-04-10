import type { Database } from "better-sqlite3";
import { join } from "node:path";
import { createClaudeCodeAdapter, type ClaudeCodeSession } from "./adapters/claude-code.js";
import { createLogger } from "../../utils/logger.js";
import { resolvePrompt } from "./prompt-resolver.js";
import { loadMemory } from "./memory.js";
import { ROLE_DEFAULT_MODEL } from "../../utils/constants.js";

const log = createLogger("session-manager");

export interface SessionManager {
  /** Spawn a session. sessionKey defaults to agentId; use a unique key for concurrent sessions on the same agent. */
  spawnAgent: (agentId: string, projectWorkdir: string, sessionKey?: string) => ClaudeCodeSession;
  getSession: (agentId: string) => ClaudeCodeSession | undefined;
  killSession: (agentId: string) => void;
  killAll: () => void;
  pauseSession: (agentId: string) => void;
  resumeSession: (agentId: string) => void;
}

export function createSessionManager(db: Database): SessionManager {
  const sessions = new Map<string, ClaudeCodeSession>();
  /** Maps session key → real agent ID (for DB operations) */
  const keyToAgentId = new Map<string, string>();
  /** Maps session key → sessions.id row — precise DB updates when multiple
   *  sessionKeys share the same agentId (e.g., concurrent verifications). */
  const keyToSessionRowId = new Map<string, string>();
  const adapter = createClaudeCodeAdapter();

  return {
    spawnAgent(agentId: string, projectWorkdir: string, sessionKey?: string): ClaudeCodeSession {
      const key = sessionKey ?? agentId;

      // Cleanup existing session for this key (memory map)
      const existing = sessions.get(key);
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

      // Session Context Chain — 최근 3개 완료 태스크의 제목만 (요약은 --add-dir로 접근 가능)
      const recentTasks = db.prepare(`
        SELECT title FROM tasks
        WHERE assignee_id = ? AND status = 'done'
        ORDER BY updated_at DESC LIMIT 3
      `).all(agentId) as { title: string }[];

      let contextChain = "";
      if (recentTasks.length > 0) {
        contextChain = "\n\n## Recently Completed Tasks\n" +
          recentTasks.map((t) => `- ${t.title}`).join("\n");
      }

      // 프로젝트 컨텍스트: tech stack만 (git log, project docs는 --add-dir로 접근 가능)
      const project = db.prepare("SELECT tech_stack, workdir FROM projects WHERE id = ?")
        .get(agent.project_id) as { tech_stack: string | null; workdir: string } | undefined;

      let projectContext = "";
      if (project?.tech_stack) {
        try {
          const stack = JSON.parse(project.tech_stack);
          projectContext += `\n\n## Tech Stack\n${stack.languages?.join(", ") || "unknown"} / ${stack.frameworks?.join(", ") || "none"}`;
        } catch { /* invalid JSON */ }
      }

      // NOTE: Project docs (plans, references) are NOT inlined — accessible via --add-dir
      // NOTE: Git log is NOT inlined — agent can run git commands if needed

      // 에이전트 메모리 로드 (3KB 제한 — 시스템 프롬프트 비대화 방지)
      const dataDir = process.env.NOVA_ORBIT_DATA_DIR || join(process.cwd(), ".nova-orbit");
      const memory = loadMemory(dataDir, agentId);

      const enrichedPrompt = resolution.prompt + contextChain + projectContext;

      // Model resolution: agent-level override > role default > CLI default
      const resolvedModel = agent.model || ROLE_DEFAULT_MODEL[agent.role] || undefined;

      const session = adapter.spawn({
        workdir: projectWorkdir,
        systemPrompt: enrichedPrompt,
        sessionBehavior: agent.session_behavior || "resume-or-new",
        resumeSessionId: lastSession?.id ?? null,
        skillsDir: agent.skills_dir || undefined,
        memoryContent: memory || undefined,
        model: resolvedModel,
      });

      // Track session in DB — use RETURNING to get session row id for PID update
      const sessionRow = db
        .prepare("INSERT INTO sessions (agent_id, status) VALUES (?, 'active') RETURNING id")
        .get(agentId) as { id: string };

      // Listen for status changes
      session.on("status", (status: string) => {
        if (status === "working" && session.process?.pid) {
          // Capture real PID once the process is confirmed running
          db.prepare("UPDATE sessions SET pid = ? WHERE id = ?").run(session.process.pid, sessionRow.id);
        }
        if (status === "working") {
          db.prepare("UPDATE agents SET status = 'working' WHERE id = ?").run(agentId);
        } else {
          db.prepare("UPDATE agents SET status = 'idle', current_activity = NULL WHERE id = ?").run(agentId);
        }
      });

      session.on("output", (text: string) => {
        // Store last output snippet — scope to this specific session row to avoid
        // clobbering sibling sessions that share the same agent_id.
        db.prepare("UPDATE sessions SET last_output = ? WHERE id = ?")
          .run(text.slice(-500), sessionRow.id);
      });

      sessions.set(key, session);
      keyToAgentId.set(key, agentId);
      keyToSessionRowId.set(key, sessionRow.id);
      log.info(`Spawned session for agent ${agentId} (key=${key}, role=${agent.role})`);
      return session;
    },

    getSession(agentId: string): ClaudeCodeSession | undefined {
      return sessions.get(agentId);
    },

    killSession(keyOrAgentId: string): void {
      const session = sessions.get(keyOrAgentId);
      if (session) {
        const realAgentId = keyToAgentId.get(keyOrAgentId) ?? keyOrAgentId;
        const sessionRowId = keyToSessionRowId.get(keyOrAgentId);
        session.removeAllListeners();
        session.cleanup();
        sessions.delete(keyOrAgentId);
        keyToAgentId.delete(keyOrAgentId);
        keyToSessionRowId.delete(keyOrAgentId);
        // Target the specific sessions row when we know it; otherwise fall back
        // to the legacy behavior. This prevents killing sibling active sessions
        // that share the same agent_id.
        if (sessionRowId) {
          db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE id = ?")
            .run(sessionRowId);
        } else {
          db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE agent_id = ? AND status = 'active'")
            .run(realAgentId);
        }
        // Only reset the agent row to idle if no sibling session for the same
        // agent_id remains alive (otherwise it should stay 'working').
        const remaining = [...keyToAgentId.values()].filter((a) => a === realAgentId).length;
        if (remaining === 0) {
          db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL, current_activity = NULL WHERE id = ?")
            .run(realAgentId);
        }
        log.info(`Killed session for agent ${realAgentId} (key=${keyOrAgentId})`);
      }
    },

    killAll(): void {
      for (const [key, session] of sessions) {
        const realAgentId = keyToAgentId.get(key) ?? key;
        const sessionRowId = keyToSessionRowId.get(key);
        session.removeAllListeners();
        session.cleanup();
        if (sessionRowId) {
          db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE id = ?")
            .run(sessionRowId);
        } else {
          db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE agent_id = ? AND status = 'active'")
            .run(realAgentId);
        }
        db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL, current_activity = NULL WHERE id = ?")
          .run(realAgentId);
      }
      sessions.clear();
      keyToAgentId.clear();
      keyToSessionRowId.clear();
      log.info("Killed all sessions");
    },

    pauseSession(agentId: string): void {
      if (process.platform === "win32") {
        throw new Error("SIGSTOP is not supported on Windows");
      }
      const session = sessions.get(agentId);
      if (!session?.process?.pid) {
        throw new Error(`No active session for agent ${agentId}`);
      }
      process.kill(session.process.pid, "SIGSTOP");
      db.prepare("UPDATE agents SET status = 'paused' WHERE id = ?").run(agentId);
      log.info(`Paused session for agent ${agentId} (pid ${session.process.pid})`);
    },

    resumeSession(agentId: string): void {
      if (process.platform === "win32") {
        throw new Error("SIGCONT is not supported on Windows");
      }
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

