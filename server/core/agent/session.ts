import type { Database } from "better-sqlite3";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { createClaudeCodeAdapter, type ClaudeCodeSession } from "./adapters/claude-code.js";
import { createLogger } from "../../utils/logger.js";
import { resolvePrompt } from "./prompt-resolver.js";
import { loadMemory } from "./memory.js";

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
        // Mark previous active sessions as killed in DB
        db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE agent_id = ? AND status = 'active'")
          .run(agentId);
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

      // Sprint 6: Session Context Chain — 최근 3개 완료 태스크 결과를 system prompt에 주입
      const recentTasks = db.prepare(`
        SELECT title, result_summary FROM tasks
        WHERE assignee_id = ? AND status = 'done' AND result_summary IS NOT NULL
        ORDER BY updated_at DESC LIMIT 3
      `).all(agentId) as { title: string; result_summary: string }[];

      let contextChain = "";
      if (recentTasks.length > 0) {
        contextChain = "\n\n## Recent Task Context\n" +
          recentTasks.map((t) => `### ${t.title}\n${t.result_summary}`).join("\n\n");
      }

      // Sprint 6: 프로젝트 컨텍스트 자동 주입 (tech stack + git log)
      const project = db.prepare("SELECT tech_stack, workdir FROM projects WHERE id = ?")
        .get(agent.project_id) as { tech_stack: string | null; workdir: string } | undefined;

      let projectContext = "";
      if (project?.tech_stack) {
        try {
          const stack = JSON.parse(project.tech_stack);
          projectContext += `\n\n## Project Tech Stack\n- Languages: ${stack.languages?.join(", ") || "unknown"}\n- Frameworks: ${stack.frameworks?.join(", ") || "none"}`;
          if (stack.buildTool) projectContext += `\n- Build: ${stack.buildTool}`;
          if (stack.testFramework) projectContext += `\n- Test: ${stack.testFramework}`;
        } catch { /* invalid JSON */ }
      }

      try {
        const gitLog = execSync("git log --oneline -5", {
          cwd: project?.workdir || projectWorkdir,
          encoding: "utf-8",
          timeout: 5000,
        });
        projectContext += `\n\n## Recent Git History\n\`\`\`\n${gitLog.trim()}\n\`\`\``;
      } catch { /* git 없는 프로젝트 */ }

      // Sprint 6: 에이전트 메모리 로드
      const dataDir = process.env.NOVA_ORBIT_DATA_DIR || join(process.cwd(), ".nova-orbit");
      const memory = loadMemory(dataDir, agentId);

      const enrichedPrompt = resolution.prompt + contextChain + projectContext;

      const session = adapter.spawn({
        workdir: projectWorkdir,
        systemPrompt: enrichedPrompt,
        sessionBehavior: agent.session_behavior || "resume-or-new",
        resumeSessionId: lastSession?.id ?? null,
        skillsDir: agent.skills_dir || undefined,
        memoryContent: memory || undefined,
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

