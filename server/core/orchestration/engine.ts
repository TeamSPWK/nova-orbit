import type { Database } from "better-sqlite3";
import { join } from "node:path";
import type { SessionManager } from "../agent/session.js";
import { parseStreamJson } from "../agent/adapters/stream-parser.js";
import { createQualityGate } from "../quality-gate/evaluator.js";
import { createDelegationEngine } from "./delegation.js";
import { executeGitWorkflow, getDefaultBranch, type GitHubConfig, type GitWorkflowResult } from "../project/git-workflow.js";
import type { WorktreeInfo } from "../project/worktree.js";
import { createLogger } from "../../utils/logger.js";
import { MAX_TITLE_LEN, MAX_DESC_LEN, MAX_SUMMARY_LEN, MAX_TASKS_PER_GOAL, MAX_TASK_RETRIES, MAX_REASSIGNS } from "../../utils/constants.js";
import type { VerificationScope } from "../../../shared/types.js";
import { appendMemory } from "../agent/memory.js";
import { createNovaRulesEngine } from "../nova-rules/index.js";
import { autoDetectScope } from "../quality-gate/evaluator.js";
import { detectAgentRunFailure } from "../../utils/errors.js";

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
  target_files: string | null;  // JSON array of paths (P2: scope anchoring)
  stack_hint: string | null;    // Short stack constraint (P2: scope anchoring)
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
 * Recover task objects from a decomposer JSON response that was truncated
 * mid-output (the common failure mode when the model hits max_tokens).
 *
 * Strategy:
 *   1. Locate `"tasks"` key and the opening `[` of its array.
 *   2. Walk character-by-character with a string-aware brace counter.
 *   3. Every time the brace depth returns to 0 we emit the slice as one
 *      candidate task object and try to JSON.parse it.
 *   4. Trailing unterminated objects are silently skipped.
 *
 * Unlike the previous regex-based recovery this is agnostic to which
 * fields the task object contains — safe across future schema additions.
 */
export function recoverTasksFromPartialJson(raw: string): any[] {
  if (!raw) return [];
  // Find the "tasks": [ start. Accept any whitespace.
  const tasksKeyIdx = raw.search(/"tasks"\s*:\s*\[/);
  if (tasksKeyIdx === -1) return [];
  const arrayStart = raw.indexOf("[", tasksKeyIdx);
  if (arrayStart === -1) return [];

  const tasks: any[] = [];
  let i = arrayStart + 1;
  const len = raw.length;

  while (i < len) {
    // Skip whitespace and commas between objects
    while (i < len && /[\s,]/.test(raw[i] ?? "")) i++;
    if (i >= len) break;
    // Array end
    if (raw[i] === "]") break;
    // Each task must start with an object literal
    if (raw[i] !== "{") {
      i++;
      continue;
    }

    // Walk the object balancing braces, respecting string literals.
    const objStart = i;
    let depth = 0;
    let inString = false;
    let escape = false;

    for (; i < len; i++) {
      const ch = raw[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth++;
        continue;
      }
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          // Complete object — try to parse
          const slice = raw.slice(objStart, i + 1);
          try {
            const parsed = JSON.parse(slice);
            if (parsed && typeof parsed === "object") tasks.push(parsed);
          } catch {
            // Skip malformed object, keep scanning
          }
          i++; // move past the closing brace
          break;
        }
      }
    }

    // If we fell out of the inner loop with depth > 0 the object was
    // truncated — nothing more to recover.
    if (depth !== 0) break;
  }

  return tasks;
}

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
/**
 * In-flight decompose lock.
 *
 * Two code paths used to call `decomposeGoal` for the same goal at the
 * same time — the scheduler's autopilot loop AND the orchestration API
 * route (or `rescuePendingGoals`). Both called `sessionManager.spawnAgent`
 * with the same `decompose-{goalId}` session key, and the second spawn
 * cleanup()'d the first one's Claude CLI with SIGTERM (exit 143), leaving
 * both callers with an empty stdout and the goal stuck at 0 tasks.
 *
 * A goal-level lock is sufficient because decompose is idempotent: the
 * second caller only needs to see that work is in progress and bail out.
 */
const inflightDecompose = new Set<string>();

export function createOrchestrationEngine(
  db: Database,
  sessionManager: SessionManager,
  broadcast: (event: string, data: unknown) => void,
) {
  const qualityGate = createQualityGate(db, sessionManager, broadcast);
  const delegationEngine = createDelegationEngine(db, sessionManager, broadcast, qualityGate);

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

      // Atomic guard: prevent duplicate execution of the same task.
      // Two code paths can race here — scheduler.executeOne AND the
      // manual /tasks/:id/execute API route. Without this, both spawn
      // a session for the same agent → the second spawn kills the first
      // → exit 143 (SIGTERM). CAS-style: only the caller that flips
      // the status from todo→in_progress proceeds.
      const cas = db.prepare(
        "UPDATE tasks SET status = 'in_progress', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status IN ('todo', 'pending_approval')",
      ).run(taskId);
      if (cas.changes === 0) {
        // Another caller already claimed this task
        const current = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
        throw new Error(`Task already ${current?.status ?? "unknown"} — skipping duplicate execution`);
      }
      broadcast("task:updated", { taskId, status: "in_progress" });

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
            db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL, current_activity = NULL WHERE id = ?")
              .run(task.assignee_id);
            broadcast("agent:status", { id: task.assignee_id, name: agentName, status: "idle" });
            return { success: true, verdict: "delegated" };
          }
        } catch (delegationErr: any) {
          log.warn(`Delegation attempt failed, falling back to direct execution: ${delegationErr.message}`);
        }
      }

      // Phase 0.5: Complexity detection + Architect phase (Nova Orchestrator alignment)
      //
      // Skip architect phase for reviewer/qa roles: their job is to critique
      // existing code, not to produce a new design. Running architect on a
      // review task wastes a multi-minute CTO session and injects design
      // suggestions that bias the evaluator away from "find problems" stance.
      // Example: a review task that names 3 .py files in its description gets
      // classified as "moderate" by the regex heuristic and burns ~5-10 min
      // on architect output the reviewer never meaningfully uses.
      const reviewerLikeRoles = new Set(["reviewer", "qa", "qa-reviewer"]);
      const isReviewerTask = reviewerLikeRoles.has(agent?.role ?? "");
      const complexity = detectComplexity(task);
      let architectContext = "";

      if (complexity !== "simple" && !task.parent_task_id && !isReviewerTask) {
        const ctoAgent = db.prepare(
          "SELECT * FROM agents WHERE project_id = ? AND role = 'cto' AND id != ? LIMIT 1",
        ).get(task.project_id, task.assignee_id) as AgentRow | undefined;

        if (ctoAgent) {
          log.info(`Architect phase for "${task.title}" (complexity: ${complexity})`);
          // Surface the architect activity on the CTO agent card so the
          // dashboard shows "architect: <task title>" instead of a silent
          // working blob with no current_activity. This mirrors what we
          // did for decompose and for the Evaluator — every multi-minute
          // phase that spawns an agent should identify itself.
          const architectActivity = `architect:${(task.title ?? "").slice(0, 80)}`;
          db.prepare(
            "UPDATE agents SET current_task_id = ?, current_activity = ? WHERE id = ?",
          ).run(taskId, architectActivity, ctoAgent.id);
          broadcast("agent:status", {
            id: ctoAgent.id,
            status: "working",
            taskId,
            activity: architectActivity,
          });
          db.prepare(
            "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'architect_started', ?)",
          ).run(
            task.project_id,
            ctoAgent.id,
            `아키텍처 설계 시작 (${complexity}): "${(task.title ?? "").slice(0, 80)}"`,
          );
          broadcast("project:updated", { projectId: task.project_id });

          const novaRules = createNovaRulesEngine();
          const architectPrompt = buildArchitectPrompt(task, novaRules);
          const archSessionKey = `architect-${taskId}`;
          try {
            const archSession = sessionManager.spawnAgent(ctoAgent.id, workdir, archSessionKey);
            // Mirror the listeners we attach to the impl session so that
            // architect-phase rate-limits and stream errors also surface to
            // the dashboard (previously they only showed up as an extra
            // architect_started retry with no explanation).
            archSession.on("rate-limit", (info: { waitMs: number; stderr: string }) => {
              broadcast("system:rate-limit", {
                agentId: ctoAgent.id,
                agentName: "architect",
                taskId,
                waitMs: info.waitMs,
                message: info.stderr,
              });
              try {
                db.prepare(
                  "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'rate_limit_hit', ?)",
                ).run(
                  task.project_id,
                  ctoAgent.id,
                  `[architect] Rate limit 감지 (${Math.round(info.waitMs / 1000)}s wait): ${(info.stderr ?? "").slice(0, 300)}`,
                );
              } catch { /* best-effort */ }
            });
            archSession.on("nova:error", (error: unknown) => {
              broadcast("system:error", { agentId: ctoAgent.id, agentName: "architect", taskId, error });
            });
            const archResult = await archSession.send(architectPrompt);
            const archParsed = parseStreamJson(archResult.stdout);
            // Silent failure detection — same gate used for impl phase. An
            // architect session that returns exit≠0 or emits only stream
            // errors (including "Empty stdout") has been looking "proceed
            // without design" in logs while silently burning rate-limit
            // budget in repeated retries. Surface it as an activity so the
            // dashboard shows WHY each architect attempt failed.
            const archFailure = detectAgentRunFailure(archResult, archParsed);
            if (archFailure) {
              log.warn(
                `Architect phase silent failure [${archFailure.code}]: ${archFailure.message}`,
                { taskId, detail: archFailure.detail },
              );
              db.prepare(
                "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'architect_failed', ?)",
              ).run(
                task.project_id,
                ctoAgent.id,
                `아키텍처 설계 실패 [${archFailure.code}]: ${archFailure.message.slice(0, 200)}${
                  archFailure.detail ? ` — ${archFailure.detail.slice(0, 200)}` : ""
                }`,
              );
              architectContext = "";
            } else {
              architectContext = archParsed.text ?? "";
              log.info(`Architect design complete for "${task.title}" (${architectContext.length} chars)`);
              db.prepare(
                "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'architect_completed', ?)",
              ).run(
                task.project_id,
                ctoAgent.id,
                `아키텍처 설계 완료 (${architectContext.length}자): "${(task.title ?? "").slice(0, 80)}"`,
              );
            }
          } catch (archErr: any) {
            log.warn(`Architect phase failed, proceeding without design: ${archErr.message}`);
            db.prepare(
              "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'architect_failed', ?)",
            ).run(
              task.project_id,
              ctoAgent.id,
              `아키텍처 설계 예외: ${(archErr?.message ?? String(archErr)).slice(0, 300)}`,
            );
          } finally {
            sessionManager.killSession(archSessionKey);
            // Clear architect activity — killSession resets status but the
            // current_activity string "architect:..." can linger if another
            // code path had already set it. Explicit WHERE guard avoids
            // stomping on activity set by later phases.
            db.prepare(
              "UPDATE agents SET current_activity = NULL WHERE id = ? AND current_activity LIKE 'architect:%'",
            ).run(ctoAgent.id);
            broadcast("agent:status", {
              id: ctoAgent.id,
              status: "idle",
            });
            // Defensive sweep: the architect is told NOT to create files but
            // historically has still done so (Nova incident: architect wrote
            // auth-infrastructure.md to project root → every subsequent task's
            // merge-to-main failed for 8h with "Your local changes would be
            // overwritten"). Auto-commit any residue immediately so future
            // merges see a clean tree.
            try {
              const { spawnSync } = await import("node:child_process");
              const statusRes = spawnSync("git", ["status", "--porcelain"], {
                cwd: workdir, stdio: "pipe", timeout: 5_000, encoding: "utf-8",
              });
              const dirty = statusRes.stdout?.trim();
              if (dirty) {
                log.warn(`Architect phase left uncommitted changes despite read-only instruction — auto-committing as docs(nova-architect):\n${dirty.slice(0, 500)}`);
                spawnSync("git", ["add", "-A"], { cwd: workdir, stdio: "pipe", timeout: 10_000 });
                const commitRes = spawnSync("git", [
                  "commit", "-m",
                  `docs(nova-architect): residue from "${task.title.slice(0, 60)}" architect phase\n\nNova Orbit auto-committed files left by the CTO architect session.\nThis prevents them from blocking subsequent task merges.`,
                ], { cwd: workdir, stdio: "pipe", timeout: 10_000, encoding: "utf-8" });
                if (commitRes.status === 0) {
                  db.prepare(
                    "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_warning', ?)"
                  ).run(task.project_id, `Architect가 파일을 생성했습니다 — 자동 커밋으로 충돌 방지: ${dirty.split('\n').length}개 파일`);
                }
              }
            } catch (sweepErr: any) {
              log.warn(`Architect residue sweep failed: ${sweepErr.message}`);
            }
          }
        }
      }

      // Auto-detect verification scope if not explicitly set (Nova §1 alignment)
      const effectiveVerificationScope = opts.verificationScope !== "standard"
        ? opts.verificationScope
        : autoDetectScope(task, undefined);

      // Phase 1: in_progress transition already done by atomic CAS guard above

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
        // Persist the raw stderr snippet so post-mortem can distinguish a
        // real 429 from noise (stderr gets truncated to 200 chars upstream,
        // which is enough for the quota-exhausted signature).
        try {
          db.prepare(
            "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'rate_limit_hit', ?)",
          ).run(
            task.project_id,
            task.assignee_id,
            `[impl] Rate limit 감지 (${Math.round(info.waitMs / 1000)}s wait): ${(info.stderr ?? "").slice(0, 300)}`,
          );
        } catch { /* best-effort */ }
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
      const execActivity = `task:${task.title?.slice(0, 80) ?? ""}`;
      db.prepare("UPDATE agents SET status = 'working', current_task_id = ?, current_activity = ? WHERE id = ?")
        .run(taskId, execActivity, task.assignee_id);
      broadcast("agent:status", { id: task.assignee_id, name: agentName, status: "working", taskId, activity: execActivity });
      broadcast("task:started", { taskId, agentId: task.assignee_id, startedAt: new Date().toISOString() });

      try {
        const novaRules = createNovaRulesEngine();
        const autoApplyRules = novaRules.getAutoApplyRules();

        // Parse scope-anchoring fields (P2: Pulsar scope-drift fix)
        const targetFiles: string[] = (() => {
          try {
            const parsed = JSON.parse(task.target_files ?? "[]");
            return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
          } catch {
            return [];
          }
        })();
        const stackHint = (task.stack_hint ?? "").trim();

        const scopeAnchor = targetFiles.length > 0 || stackHint
          ? `
## Primary Target — Stay Within Scope
${targetFiles.length > 0 ? `**Modify ONLY these files** (create them if they don't exist yet):
${targetFiles.map((f) => `- \`${f}\``).join("\n")}

If you find yourself about to create a file outside this list, STOP and ask:
"Does the task really require a new file elsewhere, or am I drifting?"` : ""}
${stackHint ? `\n**Stack constraint:** ${stackHint}

Match the conventions of the nearest existing code in the same stack. Do NOT
introduce a different framework / language / build tool to solve this task.` : ""}
`
          : "";

        const implementationPrompt = `
# Task: ${task.title}

${task.description}
${scopeAnchor}${architectContext ? `\n## Architecture Design\n${architectContext}\n` : ""}
## Nova Auto-Apply Rules
${autoApplyRules || "Follow clean code conventions and existing patterns."}

## Constraints
- Clean, production-ready code
- Follow existing codebase conventions
- Run lint/type-check before finishing
- DO NOT verify your own work — verification is handled by independent Evaluator
- Fix ONLY what the task requires — do not refactor unrelated code
${!needsWorktree ? `
## Managed Directories — DO NOT TOUCH
You are running directly in the project root (no isolated worktree). The
following directories belong to OTHER concurrent tasks and Nova Orbit's
worktree manager — do NOT create, modify, or delete files inside them:
- \`.nova-worktrees/\`
- \`.claude/worktrees/\`

Any file you create elsewhere in the project will be committed as part of
this task. Prefer returning findings as prose in your response rather than
writing files for review/QA tasks.
` : ""}
When complete, provide a summary of changes made.
`;

        const implResult = await session.send(implementationPrompt);
        const implParsed = parseStreamJson(implResult.stdout);

        // Hard gate: detect silent failures where the CLI crashed, the stream
        // emitted errors, or an API error signature leaked into assistant text.
        // Without this the task gets marked done with garbage like
        // "API Error: Unable to connect to API (ECONNRESET)" as its summary.
        const implFailure = detectAgentRunFailure(implResult, implParsed);
        if (implFailure) {
          log.error(`Implementation failed [${implFailure.code}]: ${implFailure.message}`, {
            taskId,
            taskTitle: task.title,
            detail: implFailure.detail,
          });
          broadcast("system:error", {
            agentId: task.assignee_id,
            agentName,
            taskId,
            error: implFailure.toJSON(),
          });
          // Persist token usage if any output was produced before the failure
          if (implParsed.usage) {
            db.prepare(
              "UPDATE sessions SET token_usage = token_usage + ? WHERE agent_id = ? AND status = 'active'",
            ).run(
              implParsed.usage.inputTokens + implParsed.usage.outputTokens + implParsed.usage.cacheCreationTokens,
              task.assignee_id,
            );
          }
          sessionManager.killSession(task.assignee_id);
          // Re-throw so executeTask's catch transitions the task to blocked and
          // the scheduler's retry/reassign budget takes over. This is the ONLY
          // path that prevents silent API failures from being marked done.
          throw implFailure;
        }

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

        // Defensive sweep: reviewer/qa tasks (needs_worktree=0) run at the
        // project root. If they accidentally wrote into managed worktree
        // directories, those writes belong to OTHER tasks — detect and
        // auto-clean the residue so it doesn't pollute this commit or trigger
        // `ignored by .gitignore` errors downstream. Only warns when the dirs
        // actually exist with untracked content; does not touch linked
        // worktrees themselves.
        if (!needsWorktree) {
          try {
            const { spawnSync } = await import("node:child_process");
            const statusRes = spawnSync(
              "git",
              ["status", "--porcelain", "--", ".nova-worktrees/", ".claude/worktrees/"],
              { cwd: effectiveWorkdir, stdio: "pipe", timeout: 5_000, encoding: "utf-8" },
            );
            const dirty = statusRes.stdout?.trim();
            if (dirty) {
              const lines = dirty.split("\n").filter(Boolean);
              log.warn(
                `Reviewer/QA task "${task.title}" left ${lines.length} file(s) in managed worktree dirs — auto-excluded from commit:\n${dirty.slice(0, 400)}`,
              );
              db.prepare(
                "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'autopilot_warning', ?)",
              ).run(
                task.project_id,
                task.assignee_id,
                `리뷰어/QA가 관리 디렉토리에 ${lines.length}개 파일 생성 — 자동으로 commit에서 제외됨`,
              );
            }
          } catch (sweepErr: any) {
            log.warn(`Reviewer residue sweep failed: ${sweepErr.message}`);
          }
        }

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
          db.prepare("UPDATE agents SET status = 'working', current_task_id = ?, current_activity = ? WHERE id = ?")
            .run(taskId, `fix:${task.title?.slice(0, 80) ?? ""}`, task.assignee_id);
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
            const fixResult = await fixSession.send(fixPrompt);
            const fixParsed = parseStreamJson(fixResult.stdout);
            // Same silent-failure gate as the implementation phase — a
            // failed fix attempt must not silently count as a successful fix.
            const fixFailure = detectAgentRunFailure(fixResult, fixParsed);
            if (fixFailure) {
              log.error(`Auto-fix failed [${fixFailure.code}]: ${fixFailure.message}`, {
                taskId,
                taskTitle: task.title,
                detail: fixFailure.detail,
              });
              broadcast("system:error", {
                agentId: task.assignee_id,
                agentName,
                taskId,
                error: fixFailure.toJSON(),
              });
              // Don't throw — let the re-verification decide the task's fate.
              // A failed fix call still leaves the code in its previous state,
              // which the evaluator will still catch.
            }
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
              const errorClass = gitResult.errorClass ?? "permanent";
              const errorCode = gitResult.errorCode ?? "unknown";

              if (errorClass === "benign") {
                log.info(`Re-verify git workflow benign (${errorCode}) — marking done: ${task.title}`);
                transitionTask(db, broadcast, task, "done");
                return { success: true, verdict: reVerification.verdict };
              }
              if (errorClass === "permanent") {
                db.prepare(
                  "UPDATE tasks SET retry_count = ?, reassign_count = ? WHERE id = ?",
                ).run(MAX_TASK_RETRIES, MAX_REASSIGNS, task.id);
              }
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
            // Classify the git failure so autopilot can decide: auto-recover
            // (recoverable), skip ahead (permanent), or treat as no-op (benign).
            // Default autopilot stance is to prefer recoverable — permanent
            // is reserved for errors that would deterministically re-fail.
            const errorClass = gitResult.errorClass ?? "permanent";
            const errorCode = gitResult.errorCode ?? "unknown";

            if (errorClass === "benign") {
              // e.g. nothing-to-commit — treat as success
              log.info(`Git workflow benign result for "${task.title}" (${errorCode}) — marking done`);
              transitionTask(db, broadcast, task, "done");
              return { success: true, verdict: verification.verdict };
            }

            if (errorClass === "permanent") {
              // Same input will re-fail — skip ahead to avoid budget burn.
              db.prepare(
                "UPDATE tasks SET retry_count = ?, reassign_count = ? WHERE id = ?",
              ).run(MAX_TASK_RETRIES, MAX_REASSIGNS, task.id);
              transitionTask(db, broadcast, task, "blocked");
              db.prepare(
                "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'git_error', ?)",
              ).run(task.project_id, task.assignee_id, `Permanently blocked — git ${errorCode}: ${task.title}`);
              return { success: false, verdict: "git-error" };
            }

            // Recoverable — let the scheduler's normal retry budget decide.
            // Do NOT force retry_count/reassign_count to MAX. The task goes
            // back to blocked but can be retried by retryBlockedTasks.
            transitionTask(db, broadcast, task, "blocked");
            db.prepare(
              "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'git_error', ?)",
            ).run(task.project_id, task.assignee_id, `Recoverable git error (${errorCode}) — will retry: ${task.title}`);
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

        // Duplicate execution guard — CAS failed, another caller already claimed it.
        // Do NOT transition or retry — the other execution is handling it.
        if (err.message?.includes("skipping duplicate execution")) {
          log.info(`Duplicate execution suppressed for "${task.title}"`);
          throw err; // Re-throw so caller knows, but no state mutation
        }

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
        db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL, current_activity = NULL WHERE id = ?")
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
      // Goal-level race guard — see inflightDecompose comment above.
      if (inflightDecompose.has(goalId)) {
        log.warn(`decomposeGoal skipped: another run already in progress for goal ${goalId}`);
        throw new Error(`Decompose already in progress for goal ${goalId}`);
      }
      inflightDecompose.add(goalId);

      const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as GoalRow | undefined;
      if (!goal) {
        inflightDecompose.delete(goalId);
        throw new Error(`Goal ${goalId} not found`);
      }

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

      const decomposeSessionKey = `decompose-${goal.id}`;
      let session;
      try {
        session = sessionManager.spawnAgent(agent.id, project?.workdir || process.cwd(), decomposeSessionKey);
      } catch (err: any) {
        throw new Error(`Failed to spawn agent for decomposition: ${err.message}`);
      }

      // Make the decompose visible on the agent and in the activity log so
      // the user sees "작업 분할 중..." on the goal card instead of a mute
      // zero-task state. Without this the only signal is "1 agent working"
      // on the sidebar, which does not identify the goal. (Pulsar audit.)
      const decomposeActivity = `decompose:${(goal.title || goal.description || "").slice(0, 80)}`;
      db.prepare(
        "UPDATE agents SET current_task_id = NULL, current_activity = ? WHERE id = ?",
      ).run(decomposeActivity, agent.id);
      broadcast("agent:status", {
        id: agent.id,
        status: "working",
        activity: decomposeActivity,
      });
      db.prepare(
        "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'decompose_started', ?)",
      ).run(
        goal.project_id,
        agent.id,
        `작업 분할 시작: "${(goal.title || goal.description || "").slice(0, 120)}"`,
      );
      broadcast("project:updated", { projectId: goal.project_id });

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

      // Project tech stack context — helps the decomposer fill stack_hint and
      // pick plausible target_files. Without this the decomposer has no idea
      // whether the project uses Next.js vs vanilla JS vs Django etc.
      let projectStackHint = "";
      try {
        const stackRaw = (project as any)?.tech_stack;
        if (stackRaw) {
          const stack = JSON.parse(stackRaw);
          const langs = (stack.languages ?? []).slice(0, 3).join(", ");
          const fws = (stack.frameworks ?? []).slice(0, 3).join(", ");
          projectStackHint = `\n**Project stack**: ${[langs, fws].filter(Boolean).join(" / ") || "unknown"}`;
        }
      } catch { /* ignore */ }

      const decomposePrompt = `
# Goal Decomposition

Break down this goal into concrete, actionable tasks:
${goal.title ? `**${goal.title}**\n` : ""}"${goal.description}"${projectStackHint}
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

## Required fields per task
- \`target_files\`: array of file paths this task will touch (e.g.
  \`["web/src/app/page.tsx"]\`). Use the project stack above. Empty \`[]\`
  only if you genuinely cannot guess. Evaluator rejects diff/scope drift.
- \`stack_hint\`: short framework constraint (e.g. "Next.js 16 App Router",
  "FastAPI router"). Empty string if none. Prevents wrong-stack impls.

## Fullstack contract rule (if goal touches backend API AND UI)
The first task that touches the API MUST cite the exact response shape
(field names + types) in its description. Every later task that reads
that endpoint MUST quote the same shape verbatim. Never place a frontend
fetch URL without a matching backend task for the same route+method.
Flag enum values explicitly. — Prevents contract mismatch crashes.

## Bootstrap rule (if goal touches auth / tenants / migrations / seed / gated UI)
Add ONE final "Bootstrap / Entry Point" task that makes the feature
reachable from an empty install via any of: seed script, dev-mode bypass
(env + loopback), login/signup UI, or CLI bootstrap command. Without this
the goal is implemented but unusable. If goal is pure refactor/visual,
write "no bootstrap: non-gated" in the first task's description.

Respond in this EXACT JSON format:
\`\`\`json
{
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed description with acceptance criteria",
      "role": "${availableAgents[0]?.role ?? "coder"}",
      "priority": "high",
      "order": 1,
      "target_files": ["relative/path/to/file.ext"],
      "stack_hint": "Next.js 16 App Router"
    }
  ]
}
\`\`\`
`;

      const runResult = await session.send(decomposePrompt);

      log.info(`Decompose raw: exitCode=${runResult.exitCode}, stdoutLen=${runResult.stdout.length}, stderrLen=${runResult.stderr.length}, stdout500=${runResult.stdout.slice(0, 500)}`);

      const parsed = parseStreamJson(runResult.stdout);

      log.info(`Decompose parsed: textLen=${parsed.text.length}, lineCount=${parsed.lineCount}, errors=${parsed.errors.join("; ")}, first200=${parsed.text.slice(0, 200)}`);
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
          // Truncated JSON recovery — balanced-brace parser.
          //
          // The previous regex-based recovery assumed a fixed task object
          // shape ending at `"order": <num> }` which broke the moment the
          // decomposer started emitting additional fields like
          // `target_files` / `stack_hint` (added in P2). A task object
          // with arrays and extra fields was no longer matchable.
          //
          // New strategy: scan the raw JSON for the start of the tasks
          // array and then walk character-by-character, tracking string
          // escapes and nested brace depth, to extract every complete
          // top-level object inside that array. Any trailing unterminated
          // object is simply skipped.
          log.warn(`JSON parse failed (${parseErr.message}), attempting balanced-brace recovery`);
          const partialTasks = recoverTasksFromPartialJson(jsonMatch[1] ?? "");
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
        // When multiple agents share the same role, round-robin across them so
        // decomposed tasks are evenly distributed (e.g., frontend-dev-1 and
        // frontend-dev-2 each get roughly half the frontend tasks).
        const roleAssignCount = new Map<string, number>();
        const findAgent = (role: string) => {
          const r = role.toLowerCase();
          // 1) Exact role matches
          const exactMatches = candidates.filter((a) => a.role === r);
          if (exactMatches.length > 0) {
            const count = roleAssignCount.get(r) ?? 0;
            roleAssignCount.set(r, count + 1);
            return exactMatches[count % exactMatches.length];
          }
          // 2) Partial keyword match
          const partialMatches = candidates.filter((a) => r.includes(a.role) || a.role.includes(r));
          if (partialMatches.length > 0) {
            const key = `partial:${r}`;
            const count = roleAssignCount.get(key) ?? 0;
            roleAssignCount.set(key, count + 1);
            return partialMatches[count % partialMatches.length];
          }
          // 3) Any worker fallback
          return candidates.find((a) => a.role === "coder" || a.role === "frontend" || a.role === "backend") ??
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
          // P2: scope anchoring — capture target_files + stack_hint from the
          // decomposer so both the Generator prompt and Evaluator check can
          // enforce where code belongs.
          const targetFiles = Array.isArray(t.target_files)
            ? t.target_files.filter((f: unknown) => typeof f === "string" && f.length > 0 && f.length < 260).slice(0, 20)
            : [];
          const stackHint = typeof t.stack_hint === "string" ? t.stack_hint.slice(0, 200) : "";
          // Sprint 5: tasks created from decomposition start as pending_approval
          // so the user can review the plan before execution begins
          db.prepare(`
            INSERT INTO tasks (goal_id, project_id, title, description, assignee_id, status, priority, sort_order, target_files, stack_hint)
            VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?)
          `).run(
            goal.id, goal.project_id, title, description, agent?.id ?? null,
            priority, sortOrder,
            JSON.stringify(targetFiles), stackHint,
          );
          created++;
        }

        log.info(`Created ${created} tasks from goal decomposition`);
        db.prepare(
          "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'decompose_completed', ?)",
        ).run(
          goal.project_id,
          agent.id,
          `작업 분할 완료: ${created}개 태스크 생성 — "${(goal.title || goal.description || "").slice(0, 80)}"`,
        );
        broadcast("project:updated", { projectId: goal.project_id });
        return { taskCount: created, projectId: goal.project_id };
      } catch (err: any) {
        log.error("Failed to parse task decomposition", err);
        db.prepare(
          "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'decompose_failed', ?)",
        ).run(
          goal.project_id,
          agent.id,
          `작업 분할 실패: ${String(err?.message ?? err).slice(0, 140)}`,
        );
        broadcast("project:updated", { projectId: goal.project_id });
        throw err;
      } finally {
        // Cleanup decompose session to free the agent + clear the
        // "decompose:..." activity so the idle broadcast in killSession
        // correctly reflects the agent is no longer working.
        sessionManager.killSession(decomposeSessionKey);
        db.prepare(
          "UPDATE agents SET current_activity = NULL WHERE id = ? AND current_activity LIKE 'decompose:%'",
        ).run(agent.id);
        inflightDecompose.delete(goalId);
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

      // Set CTO activity
      db.prepare("UPDATE agents SET status = 'working', current_activity = 'goal_generation' WHERE id = ?")
        .run(ctoAgent.id);
      broadcast("agent:status", { id: ctoAgent.id, status: "working", activity: "goal_generation" });

      const ctoWorkdir = project.workdir || (() => { throw new Error("Project has no workdir configured"); })();
      const missionSessionKey = `mission-${projectId}-${Date.now()}`;
      const session = sessionManager.spawnAgent(ctoAgent.id, ctoWorkdir, missionSessionKey);

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

      log.info(`Mission analysis raw: exitCode=${runResult.exitCode}, stdoutLen=${runResult.stdout.length}, stderrLen=${runResult.stderr.length}`);

      // Debug: dump raw stdout to file for analysis
      try {
        const fs = await import("node:fs");
        const debugPath = "/tmp/nova-mission-debug.txt";
        fs.writeFileSync(debugPath, `exitCode=${runResult.exitCode}\nstderr=${runResult.stderr}\n---STDOUT---\n${runResult.stdout}`);
        log.info(`Mission analysis debug dumped to ${debugPath}`);
      } catch { /* ignore */ }

      const parsed = parseStreamJson(runResult.stdout);

      log.info(`Mission analysis parsed: textLen=${parsed.text.length}, errors=${parsed.errors.join("; ")}`);

      // Try multiple extraction strategies
      let jsonMatch = parsed.text.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) {
        jsonMatch = parsed.text.match(/(\{[\s\S]*"goals"\s*:\s*\[[\s\S]*\][\s\S]*\})/);
      }
      if (!jsonMatch) throw new Error(`No JSON found in mission analysis response (textLen=${parsed.text.length}, errors=${parsed.errors.join("; ")}, first300=${parsed.text.slice(0, 300)})`);

      let data: any;
      try {
        data = JSON.parse(jsonMatch[1]);
      } catch (parseErr: any) {
        // Truncated JSON recovery: extract complete goal objects from partial JSON
        log.warn(`Mission JSON parse failed (${parseErr.message}), attempting truncated recovery`);
        const partialGoals: any[] = [];
        const goalPattern = /\{\s*"title"\s*:\s*"[^"]+"\s*,\s*"description"\s*:\s*"[^"]*"\s*,\s*"priority"\s*:\s*"[^"]*"\s*\}/g;
        let match;
        while ((match = goalPattern.exec(jsonMatch[1])) !== null) {
          try { partialGoals.push(JSON.parse(match[0])); } catch { /* skip malformed */ }
        }
        if (partialGoals.length === 0) throw parseErr;
        log.info(`Recovered ${partialGoals.length} goals from truncated JSON`);
        data = { goals: partialGoals };
      }

      const goals = (data.goals ?? []).slice(0, remainingSlots);
      const VALID_PRIORITIES = ["critical", "high", "medium", "low"];

      // Validate ALL goals before any INSERT — prevents partial-insert orphans
      // when the loop would throw midway through. Re-index AFTER filtering so
      // sort_order is contiguous (no gaps from dropped entries).
      const validGoals = goals
        .filter((g: any) => g && typeof g.description === "string" && g.description.length > 0)
        .map((g: any, index: number) => ({ g, index }));

      // Offset sort_order so new goals never collide with existing ones.
      // Without this, new goals (sort_order = 0, 1, 2...) would jump above
      // existing same-priority goals in scheduler ordering.
      const sortOrderBase = (db.prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS base FROM goals WHERE project_id = ?",
      ).get(projectId) as { base: number }).base;

      // Wrap inserts in a transaction so partial failures roll back cleanly
      const insertGoals = db.transaction((entries: { g: any; index: number }[]): string[] => {
        const ids: string[] = [];
        for (const { g, index } of entries) {
          const priority = VALID_PRIORITIES.includes(g.priority) ? g.priority : "medium";
          const row = db.prepare(
            "INSERT INTO goals (project_id, title, description, priority, sort_order) VALUES (?, ?, ?, ?, ?) RETURNING id",
          ).get(projectId, (g.title ?? g.description).slice(0, 100), g.description.slice(0, 500), priority, sortOrderBase + index) as { id: string };
          ids.push(row.id);
        }
        return ids;
      });

      const goalIds: string[] = insertGoals(validGoals);

      log.info(`Full autopilot: created ${goalIds.length} goals from mission`);
      broadcast("project:updated", { projectId });

      db.prepare(
        "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'goal_created', ?)",
      ).run(projectId, ctoAgent.id, `CTO auto-generated ${goalIds.length} goals from mission`);

      return { goalIds };
      } finally {
        // Cleanup CTO session — 성공/실패 모두
        sessionManager.killSession(missionSessionKey);
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

  // Update agent activity based on task state
  if (newStatus === "in_review" && task.assignee_id) {
    db.prepare("UPDATE agents SET current_activity = ? WHERE id = ?")
      .run(`review:${(task.title ?? "").slice(0, 80)}`, task.assignee_id);
  }

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
): Promise<GitWorkflowResult | null> {
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
  // Atomic UPDATE to avoid SELECT-then-UPDATE race with concurrent task updates.
  // Clamped to 0..100 defensively.
  db.prepare(`
    UPDATE goals SET progress = (
      SELECT
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE MAX(0, MIN(100, CAST(ROUND(100.0 * SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) / COUNT(*)) AS INTEGER)))
        END
      FROM tasks WHERE goal_id = ? AND parent_task_id IS NULL
    )
    WHERE id = ?
  `).run(goalId, goalId);
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

## ⚠️ CRITICAL: Read-Only Session
**Do NOT create, edit, or modify any files. Do NOT use the Write, Edit, or
NotebookEdit tools.** Respond with the design as text in your stdout
response only. Files created in this session pollute the project root and
break subsequent merge operations (Nova incident: stuck for 8h on merge
conflicts from an architect-created design doc).

You MAY use Read/Glob/Grep to understand the codebase, but absolutely no
writes. If you feel the need to produce a design document file, inline it
into your response instead.

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
