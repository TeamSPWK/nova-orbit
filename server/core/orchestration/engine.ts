import type { Database } from "better-sqlite3";
import { join } from "node:path";
import type { SessionManager } from "../agent/session.js";
import { parseStreamJson } from "../agent/adapters/stream-parser.js";
import { createQualityGate } from "../quality-gate/evaluator.js";
import { createDelegationEngine } from "./delegation.js";
import { executeGitWorkflow, getDefaultBranch, type GitHubConfig } from "../project/git-workflow.js";
import type { WorktreeInfo } from "../project/worktree.js";
import { createLogger } from "../../utils/logger.js";
import { MAX_TITLE_LEN, MAX_DESC_LEN, MAX_SUMMARY_LEN, MAX_TASKS_PER_GOAL } from "../../utils/constants.js";
import type { VerificationScope } from "../../../shared/types.js";
import { appendMemory } from "../agent/memory.js";
import { createNovaRulesEngine } from "../nova-rules/index.js";
import { autoDetectScope } from "../quality-gate/evaluator.js";

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
  title: string;
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

      const agent = db.prepare("SELECT name, role, needs_worktree FROM agents WHERE id = ?").get(task.assignee_id) as { name: string; role: string; needs_worktree: number } | undefined;
      const agentName = agent?.name ?? "";
      const needsWorktree = agent?.needs_worktree ?? 1; // 기본값: 워크트리 생성
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
            // Reset agent status — delegation engine's finally already handles this,
            // but ensure it's clean on the return path
            db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?")
              .run(task.assignee_id);
            broadcast("agent:status", { id: task.assignee_id, name: agentName, status: "idle" });
            return { success: true, verdict: "delegated" };
          }
        } catch (delegationErr: any) {
          log.warn(`Delegation attempt failed, falling back to direct execution: ${delegationErr.message}`);
        }
      }

      // Phase 0.5: Complexity detection + Architect phase (Nova Orchestrator alignment)
      const complexity = detectComplexity(task);
      let architectContext = "";

      if (complexity !== "simple" && !task.parent_task_id) {
        const ctoAgent = db.prepare(
          "SELECT * FROM agents WHERE project_id = ? AND role = 'cto' AND id != ? LIMIT 1",
        ).get(task.project_id, task.assignee_id) as AgentRow | undefined;

        if (ctoAgent) {
          log.info(`Architect phase for "${task.title}" (complexity: ${complexity})`);
          const novaRules = createNovaRulesEngine();
          const architectPrompt = buildArchitectPrompt(task, novaRules);
          try {
            const archSession = sessionManager.spawnAgent(ctoAgent.id, workdir);
            const archResult = await archSession.send(architectPrompt);
            const archParsed = parseStreamJson(archResult.stdout);
            architectContext = archParsed.text ?? "";
            log.info(`Architect design complete for "${task.title}" (${architectContext.length} chars)`);
          } catch (archErr: any) {
            log.warn(`Architect phase failed, proceeding without design: ${archErr.message}`);
          } finally {
            sessionManager.killSession(ctoAgent.id);
          }
        }
      }

      // Auto-detect verification scope if not explicitly set (Nova §1 alignment)
      const effectiveVerificationScope = opts.verificationScope !== "standard"
        ? opts.verificationScope
        : autoDetectScope(task, undefined);

      // Phase 1: Set task to in_progress
      transitionTask(db, broadcast, task, "in_progress");

      // Worktree isolation (Sprint 4): git repo가 있으면 격리된 worktree에서 실행
      // needs_worktree=0인 에이전트(reviewer, qa, 또는 사용자 설정)는 프로젝트 루트에서 실행
      let effectiveWorkdir = workdir;
      let worktreeInfo: WorktreeInfo | null = null;

      if (!needsWorktree) {
        log.info(`Skipping worktree for agent "${agentName}" (needs_worktree=0) — using project root`);
      } else {
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
        const novaRules = createNovaRulesEngine();
        const autoApplyRules = novaRules.getAutoApplyRules();

        const implementationPrompt = `
# Task: ${task.title}

${task.description}
${architectContext ? `\n## Architecture Design\n${architectContext}\n` : ""}
## Nova Auto-Apply Rules
${autoApplyRules || "Follow clean code conventions and existing patterns."}

## Constraints
- Clean, production-ready code
- Follow existing codebase conventions
- Run lint/type-check before finishing
- DO NOT verify your own work — verification is handled by independent Evaluator
- Fix ONLY what the task requires — do not refactor unrelated code

When complete, provide a summary of changes made.
`;

        const implResult = await session.send(implementationPrompt);
        const implParsed = parseStreamJson(implResult.stdout);

        // Update session token usage BEFORE killSession (which sets status='killed')
        if (implParsed.usage) {
          db.prepare(
            "UPDATE sessions SET token_usage = token_usage + ? WHERE agent_id = ? AND status = 'active'",
          ).run(
            implParsed.usage.inputTokens + implParsed.usage.outputTokens + implParsed.usage.cacheCreationTokens,
            task.assignee_id,
          );
        }

        // 구현 세션 즉시 정리 — verification에서 같은 agentId 충돌 방지
        sessionManager.killSession(task.assignee_id);
        log.info(`Implementation complete for task "${task.title}"`, {
          cost: implParsed.usage?.totalCostUsd,
          tokens: implParsed.usage ? implParsed.usage.inputTokens + implParsed.usage.outputTokens + implParsed.usage.cacheCreationTokens : 0,
          duration: implParsed.usage?.durationMs,
        });

        // Sprint 6: result_summary 저장 (마지막 500자)
        const summary = (implParsed.text ?? "").slice(-MAX_SUMMARY_LEN);
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
          scope: effectiveVerificationScope,
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
          // Keep agent in 'working' state during fix to prevent scheduler double-assignment
          db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?")
            .run(taskId, task.assignee_id);
          const fixSession = sessionManager.spawnAgent(task.assignee_id, effectiveWorkdir);
          fixSession.on("rate-limit", (info: { waitMs: number; stderr: string }) => {
            broadcast("system:rate-limit", {
              agentId: task.assignee_id, agentName, taskId,
              waitMs: info.waitMs, message: info.stderr,
            });
          });
          fixSession.on("nova:error", (error: unknown) => {
            broadcast("system:error", { agentId: task.assignee_id, agentName, taskId, error });
          });
          try {
            await fixSession.send(fixPrompt);
          } finally {
            sessionManager.killSession(task.assignee_id);
          }

          // Re-verify (worktree 경로 전달)
          const reVerification = await qualityGate.verify(taskId, {
            scope: effectiveVerificationScope,
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

        const errMsg = err.message?.toLowerCase() ?? "";
        const isRateLimit = errMsg.includes("rate limit") || errMsg.includes("429") || errMsg.includes("too many requests");
        // Environment errors (CLI not found, permission denied) are not retryable
        const isEnvError = errMsg.includes("enoent") || errMsg.includes("eacces") || errMsg.includes("not found") || errMsg.includes("not installed");

        const fallbackStatus = isRateLimit ? "todo" : "blocked";
        transitionTask(db, broadcast, task, fallbackStatus);

        if (fallbackStatus === "blocked") {
          const retryInfo = db.prepare("SELECT retry_count FROM tasks WHERE id = ?").get(task.id) as { retry_count: number } | undefined;
          db.prepare(
            "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'task_blocked', ?)",
          ).run(task.project_id, task.assignee_id, `Blocked (retry ${retryInfo?.retry_count ?? 0}): ${task.title} — ${err.message?.slice(0, 200)}`);

          if (isEnvError) {
            // Environment errors won't resolve with retries — exhaust retry count immediately
            db.prepare("UPDATE tasks SET retry_count = 999, reassign_count = 999 WHERE id = ?").run(task.id);
            log.error(`Task "${task.title}" permanently blocked — environment error (${err.message?.slice(0, 100)})`);
          } else {
            log.warn(`Task "${task.title}" blocked — scheduler will auto-retry if retries remain`);
          }
        } else {
          log.warn(`Task "${task.title}" returned to todo due to rate limit — will retry on next queue poll`);
        }
        throw err;
      } finally {
        // Reset agent status
        db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?")
          .run(task.assignee_id);
        broadcast("agent:status", { id: task.assignee_id, name: agentName, status: "idle" });

        // Worktree + branch 정리 (Sprint 4)
        if (worktreeInfo) {
          try {
            const { removeWorktree } = await import("../project/worktree.js");
            removeWorktree(workdir, worktreeInfo.path, worktreeInfo.branch);
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

      log.info(`Decomposing goal: "${goal.title || goal.description}"`);

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

      // Check if goal has a structured spec for richer context
      const goalSpec = db.prepare("SELECT * FROM goal_specs WHERE goal_id = ?").get(goal.id) as any;
      let specContext = "";
      if (goalSpec) {
        try {
          const prd = JSON.parse(goalSpec.prd_summary || "{}");
          const features = JSON.parse(goalSpec.feature_specs || "[]");
          const flow = JSON.parse(goalSpec.user_flow || "[]");
          const criteria = JSON.parse(goalSpec.acceptance_criteria || "[]");
          const tech = JSON.parse(goalSpec.tech_considerations || "[]");

          // Compact spec: name+priority only (no description), max 5 criteria to minimize token usage
          const featureList = features.slice(0, 8).map((f: any) => `- [${f.priority}] ${f.name}`).join("\n");
          const criteriaList = criteria.slice(0, 5).map((c: string) => `- ${c}`).join("\n");

          specContext = `

## Spec Summary
**Objective**: ${(prd.objective || "N/A").slice(0, 120)}
**Scope**: ${(prd.scope || "N/A").slice(0, 120)}

### Features (${features.length})
${featureList}

### Acceptance Criteria
${criteriaList}
`;
        } catch { /* ignore parse errors, use basic prompt */ }
      }

      const decomposePrompt = `
# Goal Decomposition

Break down this goal into concrete, actionable tasks:
${goal.title ? `**${goal.title}**\n` : ""}"${goal.description}"
${specContext}
Available team members: ${roleList || "coder"}

Rules:
- Each task should be completable by a single agent
- Include clear acceptance criteria in each task description
- Keep tasks small and focused (1-4 hours each)
- Use the "role" field to assign tasks to available team members
- Set "priority": "critical" | "high" | "medium" | "low" based on importance and dependency
- Set "order": sequential number (1, 2, 3...) reflecting execution order — tasks with dependencies on others must have a higher number
- Verification/review/QA tasks should always have the highest order number (run last)${goalSpec ? "\n- Reference the structured spec above to ensure complete coverage of all features and acceptance criteria" : ""}

Respond in this EXACT JSON format:
\`\`\`json
{
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed description with acceptance criteria",
      "role": "${availableAgents[0]?.role ?? "coder"}",
      "priority": "high",
      "order": 1
    }
  ]
}
\`\`\`
`;

      const runResult = await session.send(decomposePrompt);
      const parsed = parseStreamJson(runResult.stdout);

      log.info(`Decompose response: exitCode=${runResult.exitCode}, textLen=${parsed.text.length}, first200=${parsed.text.slice(0, 200)}`);
      if (runResult.exitCode !== 0) {
        log.error(`Decompose CLI error: stderr=${runResult.stderr.slice(0, 300)}`);
      }

      // Parse tasks from AI response — try ```json first, then raw JSON
      try {
        let jsonMatch = parsed.text.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch) {
          // Fallback: try to find raw JSON object with "tasks" array
          jsonMatch = parsed.text.match(/(\{[\s\S]*"tasks"\s*:\s*\[[\s\S]*\][\s\S]*\})/);
        }
        if (!jsonMatch) throw new Error(`No JSON found in decomposition response (textLen=${parsed.text.length}, exitCode=${runResult.exitCode}, stderr=${runResult.stderr.slice(0, 200)}, first300=${parsed.text.slice(0, 300)})`);

        let decomposed: any;
        try {
          decomposed = JSON.parse(jsonMatch[1]);
        } catch (parseErr: any) {
          // Truncated JSON recovery: extract complete task objects from partial JSON
          log.warn(`JSON parse failed (${parseErr.message}), attempting truncated recovery`);
          const partialTasks: any[] = [];
          const taskPattern = /\{\s*"title"\s*:\s*"[^"]+"\s*,\s*"description"\s*:\s*"[^"]*"\s*,\s*"role"\s*:\s*"[^"]*"\s*,\s*"priority"\s*:\s*"[^"]*"\s*,\s*"order"\s*:\s*\d+\s*\}/g;
          let match;
          while ((match = taskPattern.exec(jsonMatch[1])) !== null) {
            try { partialTasks.push(JSON.parse(match[0])); } catch { /* skip malformed */ }
          }
          if (partialTasks.length === 0) throw parseErr;
          log.info(`Recovered ${partialTasks.length} tasks from truncated JSON`);
          decomposed = { tasks: partialTasks };
        }
        const tasks = decomposed.tasks ?? [];

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

        let created = 0;

        const VALID_PRIORITIES = new Set(["critical", "high", "medium", "low"]);

        for (let i = 0; i < safeTasks.length; i++) {
          const t = safeTasks[i];
          if (!t.title || typeof t.title !== "string") continue;
          const title = t.title.slice(0, MAX_TITLE_LEN);
          const description = typeof t.description === "string" ? t.description.slice(0, MAX_DESC_LEN) : "";
          const agent = findAgent(t.role ?? "coder");
          const priority = VALID_PRIORITIES.has(t.priority) ? t.priority : "medium";
          const sortOrder = typeof t.order === "number" ? t.order : i + 1;
          // Sprint 5: tasks created from decomposition start as pending_approval
          // so the user can review the plan before execution begins
          db.prepare(`
            INSERT INTO tasks (goal_id, project_id, title, description, assignee_id, status, priority, sort_order)
            VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?)
          `).run(goal.id, goal.project_id, title, description, agent?.id ?? null, priority, sortOrder);
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

      const existingGoals = db.prepare(
        "SELECT title, description, priority, progress FROM goals WHERE project_id = ? ORDER BY created_at",
      ).all(projectId) as { title: string; description: string; priority: string; progress: number }[];

      const ctoAgent = db.prepare(
        "SELECT * FROM agents WHERE project_id = ? AND role = 'cto' LIMIT 1",
      ).get(projectId) as AgentRow | undefined;

      if (!ctoAgent) {
        throw new Error("Full autopilot requires a CTO agent");
      }

      log.info(`Full autopilot: generating goals from mission "${project.mission.slice(0, 50)}..."`);

      const ctoWorkdir = project.workdir || (() => { throw new Error("Project has no workdir configured"); })();
      const session = sessionManager.spawnAgent(ctoAgent.id, ctoWorkdir);

      try {
      const existingGoalsSection = existingGoals.length > 0
        ? `\n**Existing Goals (DO NOT duplicate):**\n${existingGoals.map((g, i) => `${i + 1}. [${g.priority}] ${g.title} — ${g.description.slice(0, 80)}`).join("\n")}\n`
        : "";

      const prompt = `
# Mission Analysis — Goal Generation

You are the CTO. Analyze this project's mission and create actionable goals.

**Mission:** "${project.mission}"
${existingGoalsSection}
Rules:
- Create at most ${remainingSlots} goals
- Each goal should be a clear milestone toward the mission
- Order goals by priority/dependency
- Keep goals achievable (not too broad, not too narrow)${existingGoals.length > 0 ? "\n- DO NOT create goals that overlap or duplicate any existing goal listed above" : ""}

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

      for (const [index, g] of goals.entries()) {
        if (!g.description || typeof g.description !== "string") continue;
        const priority = VALID_PRIORITIES.includes(g.priority) ? g.priority : "medium";
        const row = db.prepare(
          "INSERT INTO goals (project_id, title, description, priority, sort_order) VALUES (?, ?, ?, ?, ?) RETURNING id",
        ).get(projectId, (g.title ?? g.description).slice(0, 100), g.description.slice(0, 500), priority, index) as { id: string };
        goalIds.push(row.id);
      }

      log.info(`Full autopilot: created ${goalIds.length} goals from mission`);
      broadcast("project:updated", { projectId });

      db.prepare(
        "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'goal_created', ?)",
      ).run(projectId, ctoAgent.id, `CTO auto-generated ${goalIds.length} goals from mission`);

      return { goalIds };
      } finally {
        // Cleanup CTO session — 성공/실패 모두
        sessionManager.killSession(ctoAgent.id);
      }
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
  // branch는 반드시 프로젝트 기본 브랜치 — worktree 브랜치를 넣으면 자기 자신에게 머지 시도
  const projectRoot = _project.workdir;
  const defaultBranch = projectRoot ? getDefaultBranch(projectRoot) : "main";
  const effectiveConfig: GitHubConfig = githubConfig ?? {
    repoUrl: "",
    branch: defaultBranch,
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
    // 워크트리 변경사항을 main에 반영 — 후속 태스크(reviewer, qa 등)가 접근할 수 있도록
    // 모든 git 모드에서 로컬 머지 수행, push는 main_direct에서만
    const gitMode = effectiveConfig.gitMode ??
      (effectiveConfig.prMode ? "pr" : effectiveConfig.autoPush ? "main_direct" : "branch_only");
    if (worktreeBranch && result.committed) {
      const projectRoot = _project.workdir;
      if (projectRoot) {
        const { mergeBranchSequential } = await import("../project/git-workflow.js");
        const targetBranch = effectiveConfig.branch || "main";
        const merged = await mergeBranchSequential(projectRoot, worktreeBranch, targetBranch);
        if (merged) {
          log.info(`Merged ${worktreeBranch} → ${targetBranch}`);
          // main_direct 모드에서만 push (다른 모드에서는 로컬 머지만)
          if (gitMode === "main_direct") {
            const { pushBranch } = await import("../project/git-workflow.js");
            pushBranch(projectRoot, targetBranch);
          }
        } else {
          log.warn(`Merge failed — worktree branch ${worktreeBranch} preserved for manual merge`);
          result.error = `Auto-merge failed: ${worktreeBranch} → ${targetBranch}. Manual resolution may be needed.`;
          // 머지 실패를 activity log에 기록하여 대시보드에서 확인 가능
          db.prepare(`
            INSERT INTO activities (project_id, agent_id, type, message)
            VALUES (?, ?, 'git_merge_conflict', ?)
          `).run(task.project_id, task.assignee_id,
            `Auto-merge failed for ${worktreeBranch} → ${targetBranch}. Manual resolution may be needed.`);
        }
      }
    }

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

/**
 * Detect task complexity aligned with Nova §1.
 * - simple: 1-2 files, single module
 * - moderate: 3-7 files, new feature
 * - complex: 8+ files, multi-module, or high-risk domain
 */
type Complexity = "simple" | "moderate" | "complex";

function detectComplexity(task: TaskRow): Complexity {
  const text = `${task.title} ${task.description}`.toLowerCase();

  // High-risk keywords force escalation (Nova §1: auth/DB/payment → one level up)
  const highRisk = [
    "auth", "payment", "migration", "security", "schema", "deploy",
    "database", "credential", "permission", "billing", "encrypt",
  ];
  if (highRisk.some((k) => text.includes(k))) return "complex";

  // Estimate from description patterns
  const filePatterns = text.match(/\.(ts|js|tsx|jsx|py|go|rs|css|html|vue|svelte)\b/g);
  const estimatedFiles = filePatterns?.length ?? 0;

  if (estimatedFiles >= 8) return "complex";
  if (estimatedFiles >= 3) return "moderate";

  // Check for multi-module indicators
  const multiModule = ["multiple files", "여러 파일", "across modules", "다중 모듈", "refactor"];
  if (multiModule.some((k) => text.includes(k))) return "moderate";

  return "simple";
}

/**
 * Build architect prompt for CPS design phase.
 * Used for moderate/complex tasks before implementation (Nova Orchestrator Phase 2).
 */
function buildArchitectPrompt(task: TaskRow, novaRules: ReturnType<typeof createNovaRulesEngine>): string {
  const orchestratorProtocol = novaRules.getOrchestratorProtocol();

  // Extract Phase 2 (Design) section from orchestrator protocol
  const phase2Match = orchestratorProtocol.match(/### Phase 2:[\s\S]*?(?=### Phase 3:|### --design-only)/);
  const designGuidance = phase2Match ? phase2Match[0].trim() : "";

  return `# Architecture Design — CPS Pattern

You are the Architect. Design ONLY, do NOT implement.

## Task
"${task.title}"
${task.description}

## Design Guidance (from Nova Orchestrator)
${designGuidance || "Write a CPS design: Context → Problem → Solution"}

## Output
Produce a CPS design document with:
1. **Context**: Current project state, relevant files, tech stack
2. **Problem**: What exactly needs to change and why (MECE decomposition)
3. **Solution**: File structure, data flow, API boundaries, implementation order, build/verify commands

Keep the design concise (under 100 lines). Focus on what the implementer needs.
`;
}
