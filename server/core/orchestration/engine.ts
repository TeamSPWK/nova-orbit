import type { Database } from "better-sqlite3";
import { join } from "node:path";
import type { SessionManager } from "../agent/session.js";
import { parseStreamJson } from "../agent/adapters/stream-parser.js";
import { createQualityGate } from "../quality-gate/evaluator.js";
import { createDelegationEngine } from "./delegation.js";
import { executeGitWorkflow, type GitHubConfig } from "../project/git-workflow.js";
import type { WorktreeInfo } from "../project/worktree.js";
import { createLogger } from "../../utils/logger.js";
import type { VerificationScope } from "../../../shared/types.js";
import { appendMemory } from "../agent/memory.js";

const log = createLogger("orchestration");

// DB row types (snake_case as stored in SQLite)
interface TaskRow {
  id: string;
  goal_id: string;
  project_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  parent_task_id: string | null;
  status: string;
  verification_id: string | null;
}
interface ProjectRow {
  id: string;
  name: string;
  mission: string;
  workdir: string;
  autopilot: string; // 'off' | 'goal' | 'full'
}
interface GoalRow {
  id: string;
  project_id: string;
  description: string;
}
interface AgentRow {
  id: string;
  role: string;
  parent_id: string | null;
}

export interface OrchestrationConfig {
  verificationScope: VerificationScope;
  autoFix: boolean;
  maxFixRetries: number;
}

const DEFAULT_CONFIG: OrchestrationConfig = {
  verificationScope: "standard",
  autoFix: true,
  maxFixRetries: 1,
};

/**
 * Orchestration Engine — Goal → Task decomposition → Agent execution → Verification
 *
 * Pipeline (ported from Nova Orchestrator):
 * 1. Receive goal/task
 * 2. Assign to appropriate agent (Coder)
 * 3. Agent executes via Claude Code session
 * 4. Quality Gate verification (independent Evaluator)
 * 5. If FAIL + autoFix: spawn fix agent → re-verify (max 1 retry)
 * 6. Report results
 */
export function createOrchestrationEngine(
  db: Database,
  sessionManager: SessionManager,
  broadcast: (event: string, data: unknown) => void,
) {
  const qualityGate = createQualityGate(db, sessionManager);
  const delegationEngine = createDelegationEngine(db, sessionManager, broadcast);

  return {
    /**
     * Execute a single task: assign → run → verify → (optional fix)
     */
    async executeTask(
      taskId: string,
      config: Partial<OrchestrationConfig> = {},
    ): Promise<{ success: boolean; verdict: string }> {
      const opts = { ...DEFAULT_CONFIG, ...config };
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
      if (!task) throw new Error(`Task ${taskId} not found`);

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(task.project_id) as ProjectRow | undefined;
      if (!project) throw new Error(`Project not found`);

      log.info(`Executing task: "${task.title}"`);

      // Pre-check: assignee must exist before any state changes
      if (!task.assignee_id) {
        throw new Error("Task has no assigned agent");
      }

      const agent = db.prepare("SELECT name FROM agents WHERE id = ?").get(task.assignee_id) as { name: string } | undefined;
      const agentName = agent?.name ?? "";
      const workdir = project.workdir || (() => { throw new Error("Project has no workdir configured"); })();
      const { existsSync } = await import("node:fs");
      if (!existsSync(workdir)) {
        throw new Error(`Working directory does not exist: ${workdir}`);
      }

      // Phase 0: Attempt delegation to subordinates (only for root tasks)
      if (!task.parent_task_id) {
        try {
          const delegation = await delegationEngine.attemptDelegation(taskId);
          if (delegation.delegated) {
            log.info(`Task "${task.title}" delegated to ${delegation.subtaskIds.length} subtasks`);
            return { success: true, verdict: "delegated" };
          }
        } catch (delegationErr: any) {
          log.warn(`Delegation attempt failed, falling back to direct execution: ${delegationErr.message}`);
        }
      }

      // Phase 1: Set task to in_progress
      transitionTask(db, broadcast, task, "in_progress");

      // Worktree isolation (Sprint 4): git repo가 있으면 격리된 worktree에서 실행
      let effectiveWorkdir = workdir;
      let worktreeInfo: WorktreeInfo | null = null;

      try {
        const { createWorktree } = await import("../project/worktree.js");
        worktreeInfo = createWorktree(workdir, agentName, task.title);
        if (worktreeInfo) {
          effectiveWorkdir = worktreeInfo.path;
          log.info(`Using worktree: ${effectiveWorkdir}`);
        }
      } catch (err: any) {
        log.warn(`Worktree creation failed, using direct workdir: ${err.message}`);
      }

      // Phase 2: Execute via assigned agent
      let session;
      try {
        session = sessionManager.spawnAgent(task.assignee_id, effectiveWorkdir);
      } catch (spawnErr: any) {
        log.error(`Failed to spawn agent for task "${task.title}"`, spawnErr);
        throw new Error(`Agent spawn failed: ${spawnErr.message}`);
      }

      // Stream agent output to WebSocket
      session.on("output", (text: string) => {
        broadcast("agent:output", { agentId: task.assignee_id, output: text, taskId });
      });

      session.on("rate-limit", (info: { waitMs: number; stderr: string }) => {
        broadcast("system:rate-limit", {
          agentId: task.assignee_id,
          agentName,
          taskId,
          waitMs: info.waitMs,
          message: info.stderr,
        });
      });

      // Sprint 5: broadcast structured errors for Trust UX
      session.on("nova:error", (error: unknown) => {
        broadcast("system:error", {
          agentId: task.assignee_id,
          agentName,
          taskId,
          error,
        });
      });
      db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?")
        .run(taskId, task.assignee_id);
      broadcast("agent:status", { id: task.assignee_id, name: agentName, status: "working", taskId });
      broadcast("task:started", { taskId, agentId: task.assignee_id, startedAt: new Date().toISOString() });

      try {
        const implementationPrompt = `
# Task: ${task.title}

${task.description}

Implement this task. Focus on:
- Clean, production-ready code
- Follow existing codebase conventions
- Run lint/type-check before finishing
- DO NOT verify your own work — verification is handled separately

When complete, provide a summary of changes made.
`;

        const implResult = await session.send(implementationPrompt);
        const implParsed = parseStreamJson(implResult.stdout);
        log.info(`Implementation complete for task "${task.title}"`, {
          cost: implParsed.usage?.totalCostUsd,
          tokens: implParsed.usage ? implParsed.usage.inputTokens + implParsed.usage.outputTokens + implParsed.usage.cacheCreationTokens : 0,
          duration: implParsed.usage?.durationMs,
        });

        // Sprint 6: result_summary 저장 (마지막 500자)
        const summary = (implParsed.text ?? "").slice(-500);
        db.prepare("UPDATE tasks SET result_summary = ? WHERE id = ?").run(summary, task.id);

        // Sprint 6: 에이전트 메모리에 태스크 완료 기록
        if (task.assignee_id) {
          const dataDir = process.env.NOVA_ORBIT_DATA_DIR || join(process.cwd(), ".nova-orbit");
          const memoryEntry = `Task "${task.title}" completed. Summary: ${summary}`;
          try {
            appendMemory(dataDir, task.assignee_id, memoryEntry);
          } catch (memErr: any) {
            log.warn(`Failed to append agent memory: ${memErr.message}`);
          }
        }

        // Broadcast usage data for dashboard
        if (implParsed.usage) {
          broadcast("task:usage", {
            taskId,
            agentId: task.assignee_id,
            usage: implParsed.usage,
          });

          // Update session token usage in DB
          db.prepare(
            "UPDATE sessions SET token_usage = token_usage + ? WHERE agent_id = ? AND status = 'active'",
          ).run(
            implParsed.usage.inputTokens + implParsed.usage.outputTokens + implParsed.usage.cacheCreationTokens,
            task.assignee_id,
          );
        }

        // Broadcast completion
        broadcast("task:completed", {
          taskId,
          agentId: task.assignee_id,
          completedAt: new Date().toISOString(),
        });

        // Log activity
        db.prepare(`
          INSERT INTO activities (project_id, agent_id, type, message)
          VALUES (?, ?, 'task_completed', ?)
        `).run(task.project_id, task.assignee_id, `Completed: ${task.title}`);

        // Subtasks skip verification (design decision: parent task level QG only)
        if (task.parent_task_id) {
          transitionTask(db, broadcast, task, "done");
          return { success: true, verdict: "pass" };
        }

        // Phase 3: Move to review
        transitionTask(db, broadcast, task, "in_review");

        // Phase 4: Quality Gate verification (worktree 경로 전달)
        const verification = await qualityGate.verify(taskId, {
          scope: opts.verificationScope,
          workdir: effectiveWorkdir,
        });

        broadcast("verification:result", verification);

        // Phase 5: Auto-fix if needed
        if (verification.verdict === "fail" && opts.autoFix && opts.maxFixRetries > 0) {
          log.info("Verification FAIL — attempting auto-fix");

          // Sprint 6: Smart Resume — 이전 실패 이력 조회
          const previousFailures = db.prepare(`
            SELECT v.issues FROM verifications v
            WHERE v.task_id = ? AND v.verdict = 'fail'
            ORDER BY v.created_at DESC LIMIT 2
          `).all(task.id) as { issues: string }[];

          const failureContext = previousFailures.length > 0
            ? `\n\n## Previous Failure History\n` +
              previousFailures.map((f, i) => {
                try {
                  const issues = JSON.parse(f.issues);
                  return `### Attempt ${i + 1}\n` + issues.map((issue: any) => `- [${issue.severity}] ${issue.message}`).join("\n");
                } catch { return `### Attempt ${i + 1}\n- ${f.issues}`; }
              }).join("\n\n")
            : "";

          const fixPrompt = `
# Fix Required (Smart Resume)
${failureContext}

The following issues were found during verification:
${verification.issues.map((i) => `- [${i.severity}] ${i.file ?? ""}:${i.line ?? ""} — ${i.message}`).join("\n")}

Fix ONLY these issues. Do not modify other code.
`;
          // Spawn a NEW session for fix (prevent context pollution — Nova rule)
          const fixSession = sessionManager.spawnAgent(task.assignee_id, effectiveWorkdir);
          try {
            await fixSession.send(fixPrompt);
          } finally {
            sessionManager.killSession(task.assignee_id);
          }

          // Re-verify (worktree 경로 전달)
          const reVerification = await qualityGate.verify(taskId, {
            scope: opts.verificationScope,
            workdir: effectiveWorkdir,
          });
          broadcast("verification:result", reVerification);

          // Update task status based on re-verification result
          const rePass = reVerification.verdict === "pass" || reVerification.verdict === "conditional";

          if (rePass) {
            const gitResult = await runGitWorkflow(db, broadcast, task, project, agentName, effectiveWorkdir, worktreeInfo?.branch);
            if (gitResult?.error) {
              transitionTask(db, broadcast, task, "blocked");
              return { success: false, verdict: "git-error" };
            }
          }

          transitionTask(db, broadcast, task, rePass ? "done" : "blocked");

          return {
            success: reVerification.verdict === "pass",
            verdict: reVerification.verdict,
          };
        }

        // Update task status based on verification result
        // pass + conditional → done, fail → blocked
        const passed = verification.verdict === "pass" || verification.verdict === "conditional";

        if (passed) {
          const gitResult = await runGitWorkflow(db, broadcast, task, project, agentName, effectiveWorkdir, worktreeInfo?.branch);
          if (gitResult?.error) {
            transitionTask(db, broadcast, task, "blocked");
            return { success: false, verdict: "git-error" };
          }
        }

        transitionTask(db, broadcast, task, passed ? "done" : "blocked");

        return {
          success: verification.verdict === "pass",
          verdict: verification.verdict,
        };
      } catch (err: any) {
        log.error(`Task execution failed: ${task.title}`, err);
        // Rate limit errors → back to todo for retry, not blocked
        const isRateLimit = err.message?.toLowerCase().includes("rate limit") ||
          err.message?.toLowerCase().includes("429") ||
          err.message?.toLowerCase().includes("too many requests");
        const fallbackStatus = isRateLimit ? "todo" : "blocked";
        transitionTask(db, broadcast, task, fallbackStatus);
        if (isRateLimit) {
          log.warn(`Task "${task.title}" returned to todo due to rate limit — will retry on next queue poll`);
        }
        throw err;
      } finally {
        // Reset agent status
        db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?")
          .run(task.assignee_id);
        broadcast("agent:status", { id: task.assignee_id, name: agentName, status: "idle" });

        // Worktree 정리 (Sprint 4)
        if (worktreeInfo) {
          try {
            const { removeWorktree } = await import("../project/worktree.js");
            removeWorktree(workdir, worktreeInfo.path);
          } catch { /* 정리 실패는 무시 */ }
        }
      }
    },

    /**
     * Decompose a goal into tasks using AI.
     * Returns the number of tasks created (used by autopilot to trigger queue).
     */
    async decomposeGoal(goalId: string): Promise<{ taskCount: number; projectId: string }> {
      const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as GoalRow | undefined;
      if (!goal) throw new Error(`Goal ${goalId} not found`);

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(goal.project_id) as ProjectRow | undefined;

      log.info(`Decomposing goal: "${goal.description}"`);

      // Prefer CTO/lead agent for decomposition; fall back to any agent
      const agent = db.prepare(
        "SELECT * FROM agents WHERE project_id = ? AND role = 'cto' LIMIT 1",
      ).get(goal.project_id) as AgentRow | undefined
        ?? db.prepare(
          "SELECT * FROM agents WHERE project_id = ? LIMIT 1",
        ).get(goal.project_id) as AgentRow | undefined;

      if (!agent) {
        throw new Error("No agents available for task decomposition");
      }

      let session;
      try {
        session = sessionManager.spawnAgent(agent.id, project?.workdir || process.cwd());
      } catch (err: any) {
        throw new Error(`Failed to spawn agent for decomposition: ${err.message}`);
      }

      // Gather available roles for the prompt
      const availableAgents = db.prepare(
        "SELECT name, role FROM agents WHERE project_id = ? AND role != 'cto'",
      ).all(goal.project_id) as { name: string; role: string }[];
      const roleList = availableAgents.map((a) => `"${a.role}" (${a.name})`).join(", ");

      const decomposePrompt = `
# Goal Decomposition

Break down this goal into concrete, actionable tasks:
"${goal.description}"

Available team members: ${roleList || "coder"}

Rules:
- Each task should be completable by a single agent
- Tasks should be ordered by dependency
- Include clear acceptance criteria in each task description
- Keep tasks small and focused (1-4 hours each)
- Use the "role" field to assign tasks to available team members

Respond in this EXACT JSON format:
\`\`\`json
{
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed description with acceptance criteria",
      "role": "${availableAgents[0]?.role ?? "coder"}"
    }
  ]
}
\`\`\`
`;

      const runResult = await session.send(decomposePrompt);
      const parsed = parseStreamJson(runResult.stdout);

      // Parse tasks from AI response
      try {
        const jsonMatch = parsed.text.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch) throw new Error("No JSON found in decomposition response");

        const decomposed = JSON.parse(jsonMatch[1]);
        const tasks = decomposed.tasks ?? [];

        // Safety: cap task count to prevent runaway decomposition
        const MAX_TASKS_PER_GOAL = 10;
        const safeTasks = tasks.slice(0, MAX_TASKS_PER_GOAL);

        // Auto-assign agents by role — prefer CTO's children, fallback to all non-CTO
        const projectAgents = db.prepare(
          "SELECT * FROM agents WHERE project_id = ?",
        ).all(goal.project_id) as AgentRow[];

        const ctoAgent = projectAgents.find((a) => a.role === "cto");
        const ctoChildren = ctoAgent
          ? projectAgents.filter((a) => a.parent_id === ctoAgent.id)
          : [];
        // If CTO has no children, use all non-CTO agents as candidates
        const nonCto = projectAgents.filter((a) => a.role !== "cto");
        const candidates = ctoChildren.length > 0 ? ctoChildren : nonCto;

        // Flexible role matching: exact → partial keyword → any coder → first available
        const findAgent = (role: string) => {
          const r = role.toLowerCase();
          return candidates.find((a) => a.role === r) ??
            candidates.find((a) => r.includes(a.role) || a.role.includes(r)) ??
            candidates.find((a) => a.role === "coder" || a.role === "frontend" || a.role === "backend") ??
            candidates[0] ?? projectAgents.find((a) => a.role !== "cto") ?? projectAgents[0] ?? null;
        };

        const MAX_TITLE_LEN = 200;
        const MAX_DESC_LEN = 2000;
        let created = 0;

        for (const t of safeTasks) {
          if (!t.title || typeof t.title !== "string") continue;
          const title = t.title.slice(0, MAX_TITLE_LEN);
          const description = typeof t.description === "string" ? t.description.slice(0, MAX_DESC_LEN) : "";
          const agent = findAgent(t.role ?? "coder");
          // Sprint 5: tasks created from decomposition start as pending_approval
          // so the user can review the plan before execution begins
          db.prepare(`
            INSERT INTO tasks (goal_id, project_id, title, description, assignee_id, status)
            VALUES (?, ?, ?, ?, ?, 'pending_approval')
          `).run(goal.id, goal.project_id, title, description, agent?.id ?? null);
          created++;
        }

        log.info(`Created ${created} tasks from goal decomposition`);
        broadcast("project:updated", { projectId: goal.project_id });
        return { taskCount: created, projectId: goal.project_id };
      } catch (err) {
        log.error("Failed to parse task decomposition", err);
        throw err;
      } finally {
        // Cleanup decompose session to free the agent
        sessionManager.killSession(agent.id);
      }
    },

    /**
     * Full Autopilot: CTO generates goals from project mission.
     * Safety: max 5 goals per invocation, auto-downgrades to 'goal' mode after completion.
     */
    async generateGoalsFromMission(projectId: string): Promise<{ goalIds: string[] }> {
      const MAX_AUTO_GOALS = 5;

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
      if (!project) throw new Error(`Project ${projectId} not found`);

      if (!project.mission || project.mission.trim() === "") {
        throw new Error("Project has no mission set — cannot generate goals in Full mode");
      }

      // Safety: check if there are already pending/in_progress goals
      const activeGoals = db.prepare(
        "SELECT COUNT(*) as count FROM goals WHERE project_id = ? AND progress < 100",
      ).get(projectId) as { count: number };

      if (activeGoals.count >= MAX_AUTO_GOALS) {
        log.warn(`Full autopilot: project already has ${activeGoals.count} active goals, skipping generation`);
        return { goalIds: [] };
      }

      const remainingSlots = MAX_AUTO_GOALS - activeGoals.count;

      const ctoAgent = db.prepare(
        "SELECT * FROM agents WHERE project_id = ? AND role = 'cto' LIMIT 1",
      ).get(projectId) as AgentRow | undefined;

      if (!ctoAgent) {
        throw new Error("Full autopilot requires a CTO agent");
      }

      log.info(`Full autopilot: generating goals from mission "${project.mission.slice(0, 50)}..."`);

      const session = sessionManager.spawnAgent(ctoAgent.id, project.workdir || (() => { throw new Error("Project has no workdir configured"); })());

      const prompt = `
# Mission Analysis — Goal Generation

You are the CTO. Analyze this project's mission and create actionable goals.

**Mission:** "${project.mission}"

Rules:
- Create at most ${remainingSlots} goals
- Each goal should be a clear milestone toward the mission
- Order goals by priority/dependency
- Keep goals achievable (not too broad, not too narrow)

Respond in this EXACT JSON format:
\`\`\`json
{
  "goals": [
    {
      "description": "Goal description",
      "priority": "critical" | "high" | "medium" | "low"
    }
  ]
}
\`\`\`
`;

      const runResult = await session.send(prompt);
      const parsed = parseStreamJson(runResult.stdout);

      const jsonMatch = parsed.text.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) throw new Error("No JSON found in mission analysis response");

      const data = JSON.parse(jsonMatch[1]);
      const goals = (data.goals ?? []).slice(0, remainingSlots);
      const VALID_PRIORITIES = ["critical", "high", "medium", "low"];
      const goalIds: string[] = [];

      for (const g of goals) {
        if (!g.description || typeof g.description !== "string") continue;
        const priority = VALID_PRIORITIES.includes(g.priority) ? g.priority : "medium";
        const result = db.prepare(
          "INSERT INTO goals (project_id, description, priority) VALUES (?, ?, ?)",
        ).run(projectId, g.description.slice(0, 500), priority);
        const row = db.prepare("SELECT id FROM goals WHERE rowid = ?").get(result.lastInsertRowid) as { id: string };
        goalIds.push(row.id);
      }

      log.info(`Full autopilot: created ${goalIds.length} goals from mission`);
      broadcast("project:updated", { projectId });

      db.prepare(
        "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'goal_created', ?)",
      ).run(projectId, ctoAgent.id, `CTO auto-generated ${goalIds.length} goals from mission`);

      // Cleanup CTO session
      sessionManager.killSession(ctoAgent.id);

      return { goalIds };
    },
  };
}

/** Centralized task status transition — single source of truth for status changes + goal progress */
function transitionTask(
  db: Database,
  broadcast: (event: string, data: unknown) => void,
  task: TaskRow,
  newStatus: string,
): void {
  db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newStatus, task.id);
  broadcast("task:updated", { ...task, status: newStatus });
  if (newStatus === "done" && !task.parent_task_id) {
    updateGoalProgress(db, task.goal_id);
  }
}

/** Read github_config JSON from projects table. Returns null if not set. */
function getGitHubConfig(db: Database, projectId: string): GitHubConfig | null {
  const row = db
    .prepare("SELECT github_config FROM projects WHERE id = ?")
    .get(projectId) as { github_config: string | null } | undefined;
  if (!row?.github_config) return null;
  try {
    return JSON.parse(row.github_config) as GitHubConfig;
  } catch {
    return null;
  }
}

/**
 * Run git workflow after a task passes verification.
 * - With githubConfig: full workflow (commit → push → PR)
 * - Without githubConfig: local commit only (코드 보존 — worktree 정리 전 필수)
 * Never throws — git failures must not corrupt already-verified code.
 */
async function runGitWorkflow(
  db: Database,
  broadcast: (event: string, data: unknown) => void,
  task: TaskRow,
  _project: ProjectRow,
  agentName: string,
  workdir: string,
  worktreeBranch?: string,
): Promise<{ error?: string } | null> {
  const githubConfig = getGitHubConfig(db, task.project_id);

  // github_config 없어도 로컬 commit은 수행 (worktree 정리 전 코드 보존)
  const effectiveConfig: GitHubConfig = githubConfig ?? {
    repoUrl: "",
    branch: worktreeBranch ?? "main",
    autoPush: false,
    prMode: false,
    gitMode: "local_only",
  };

  const result = executeGitWorkflow(workdir, task.title, agentName, effectiveConfig, {
    overrideBranch: worktreeBranch,
  });

  broadcast("task:git", {
    taskId: task.id,
    committed: result.committed,
    pushed: result.pushed,
    prUrl: result.prUrl,
    branch: result.branch,
    filesChanged: result.filesChanged,
    error: result.error,
  });

  if (result.error) {
    log.error(`Git workflow failed for task "${task.title}": ${result.error}`);
    db.prepare(`
      INSERT INTO activities (project_id, agent_id, type, message)
      VALUES (?, ?, 'git_error', ?)
    `).run(task.project_id, task.assignee_id, `Git error on task "${task.title}": ${result.error}`);
  } else {
    log.info(`Git workflow complete for task "${task.title}"`, {
      committed: result.committed,
      pushed: result.pushed,
      prUrl: result.prUrl,
    });
  }

  return result;
}

function updateGoalProgress(db: Database, goalId: string): void {
  const stats = db.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
    FROM tasks WHERE goal_id = ? AND parent_task_id IS NULL
  `).get(goalId) as { total: number; done: number };
  const progress = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  db.prepare("UPDATE goals SET progress = ? WHERE id = ?").run(progress, goalId);
}
