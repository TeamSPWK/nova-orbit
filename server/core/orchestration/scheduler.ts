import type { Database } from "better-sqlite3";
import type { SessionManager } from "../agent/session.js";
import { createOrchestrationEngine } from "./engine.js";
import { createDelegationEngine } from "./delegation.js";
import { createQualityGate } from "../quality-gate/evaluator.js";
import { createLogger } from "../../utils/logger.js";
import {
  POLL_INTERVAL_MS, BACKOFF_BASE_MS, BACKOFF_MAX_MS,
  MAX_CONSECUTIVE_RATE_LIMITS, DEFAULT_MAX_CONCURRENCY,
  RATE_LIMIT_COOLDOWN_MS,
  MAX_TASK_RETRIES, MAX_REASSIGNS, BLOCKED_RETRY_DELAY_MS,
  TASK_TIMEOUT_MS,
} from "../../utils/constants.js";

const log = createLogger("scheduler");

export interface Scheduler {
  startQueue: (projectId: string) => void;
  stopQueue: (projectId: string) => void;
  isRunning: (projectId: string) => boolean;
  isPaused: (projectId: string) => boolean;
  resumeQueue: (projectId: string) => void;
  getQueueState: (projectId: string) => QueueState;
}

export interface QueueState {
  running: boolean;
  paused: boolean;
  activeTasks: number;
  maxConcurrency: number;
  rateLimitRetries: number;
  nextRetryAt: string | null;
}

/**
 * Parallel task scheduler with per-agent concurrency control.
 *
 * - Each agent runs at most 1 task at a time (prevents session conflicts).
 * - Different agents run in parallel (up to maxConcurrency).
 * - Rate limit: pauses queue with exponential backoff.
 * - 3 consecutive rate limits → full stop.
 */
export function createScheduler(
  db: Database,
  sessionManager: SessionManager,
  broadcast: (event: string, data: unknown) => void,
): Scheduler & { setSpecGenerator: (fn: (goalId: string) => Promise<any>) => void } {
  const engine = createOrchestrationEngine(db, sessionManager, broadcast);
  // Share the same quality gate so parent-task verification works from both
  // engine (direct execution) and scheduler (delegation completion paths).
  const qualityGate = createQualityGate(db, sessionManager, broadcast);
  const delegationEngine = createDelegationEngine(db, sessionManager, broadcast, qualityGate);
  let generateGoalSpec: ((goalId: string) => Promise<any>) | null = null;

  // projectId → timer handle
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Prevent duplicate pipeline work. Two disjoint key namespaces share this
   * Set intentionally:
   * - `${projectId}`       → mission → goals generation (full autopilot)
   * - `process-${projectId}` → sequential goal processing (processNextGoal)
   * They gate different operations, so using one Set with prefixed keys keeps
   * them independent without extra state.
   */
  const fullAutopilotLock = new Set<string>();

  // projectId → set of currently busy agent IDs
  const busyAgents = new Map<string, Set<string>>();

  // projectId → rate limit state
  const pauseState = new Map<string, {
    paused: boolean;
    consecutiveRateLimits: number;
    resumeTimer: ReturnType<typeof setTimeout> | null;
    nextRetryAt: Date | null;
  }>();

  // Deduplicate noisy "Deferring reviewer task" logs — log once per task, then only when remaining count changes
  const lastDeferLog = new Map<string, number>();
  function logDeferOnce(taskId: string, title: string, remaining: number): void {
    if (lastDeferLog.get(taskId) === remaining) return;
    lastDeferLog.set(taskId, remaining);
    log.info(`Deferring reviewer task "${title}" — ${remaining} sibling tasks still incomplete`);
  }

  /**
   * Per-project stuck-state detection. When pickNextTasks returns nothing
   * repeatedly but there IS outstanding work, the scheduler is silently
   * idle — the user sees "Auto 실행 중" with no activity and no idea why.
   * Track consecutive empty polls and surface a diagnosis when it crosses
   * a threshold, with dedup so we don't spam activities.
   */
  const stuckState = new Map<string, {
    emptyPollCount: number;
    lastWarnedAt: number;
    lastDiagnosisKey: string;
  }>();
  const STUCK_POLL_THRESHOLD = 30; // ~30s of empty polls before warning
  const STUCK_REWARN_MS = 5 * 60 * 1000; // re-warn every 5 min

  /**
   * Explain WHY pickNextTasks is returning nothing even though work exists.
   * Returns a short Korean summary suitable for the activity feed.
   */
  function diagnoseStuck(projectId: string): { summary: string; code: string } | null {
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todo,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) AS in_review,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status = 'blocked' AND retry_count >= ? AND reassign_count >= ? THEN 1 ELSE 0 END) AS permanent_blocked,
        SUM(CASE WHEN status = 'todo' AND assignee_id IS NULL THEN 1 ELSE 0 END) AS unassigned_todo
      FROM tasks WHERE project_id = ?
    `).get(MAX_TASK_RETRIES, MAX_REASSIGNS, projectId) as any;

    if (!counts || (counts.todo === 0 && counts.blocked === 0)) {
      return null; // genuinely nothing to do
    }

    if (counts.unassigned_todo > 0) {
      const agentCount = (db.prepare("SELECT COUNT(*) as n FROM agents WHERE project_id = ?").get(projectId) as { n: number }).n;
      if (agentCount === 0) {
        return {
          code: "no_agents",
          summary: `할당 가능한 에이전트가 없습니다 — 에이전트를 추가해주세요 (미할당 태스크 ${counts.unassigned_todo}개)`,
        };
      }
    }

    // Check if all remaining todo tasks are reviewer-gated
    const reviewerGated = db.prepare(`
      SELECT COUNT(*) AS cnt FROM tasks t
      WHERE t.project_id = ? AND t.status = 'todo'
        AND t.assignee_id IN (SELECT id FROM agents WHERE project_id = ? AND role IN ('qa-reviewer','reviewer','qa'))
        AND EXISTS (
          SELECT 1 FROM tasks s
          WHERE s.goal_id = t.goal_id AND s.id != t.id AND s.status != 'done'
            AND NOT (s.status = 'blocked' AND s.retry_count >= ? AND s.reassign_count >= ?)
            AND s.assignee_id NOT IN (SELECT id FROM agents WHERE project_id = ? AND role IN ('qa-reviewer','reviewer','qa'))
        )
    `).get(projectId, projectId, MAX_TASK_RETRIES, MAX_REASSIGNS, projectId) as { cnt: number };

    const allTodo = (counts.todo ?? 0) as number;
    if (reviewerGated.cnt > 0 && reviewerGated.cnt === allTodo) {
      return {
        code: "reviewer_gate_lock",
        summary: `모든 남은 태스크가 리뷰어 대기 중 — 형제 태스크를 먼저 완료해야 합니다 (${reviewerGated.cnt}개 gated)`,
      };
    }

    if (counts.permanent_blocked > 0) {
      return {
        code: "permanent_blocked",
        summary: `재시도 불가능한 차단된 태스크 ${counts.permanent_blocked}개 — 수동 개입 필요`,
      };
    }

    if (counts.blocked > 0 && counts.todo === 0 && counts.in_progress === 0) {
      return {
        code: "all_blocked",
        summary: `모든 활성 태스크가 차단됨 (blocked ${counts.blocked}개) — 원인 확인 필요`,
      };
    }

    return {
      code: "unknown_idle",
      summary: `태스크 ${allTodo}개가 대기 중이지만 실행되지 않음 — 큐 상태 확인 필요`,
    };
  }

  function checkStuckState(projectId: string, pickedCount: number): void {
    if (pickedCount > 0) {
      stuckState.delete(projectId);
      return;
    }
    const state = stuckState.get(projectId) ?? { emptyPollCount: 0, lastWarnedAt: 0, lastDiagnosisKey: "" };
    state.emptyPollCount++;

    if (state.emptyPollCount < STUCK_POLL_THRESHOLD) {
      stuckState.set(projectId, state);
      return;
    }

    const diagnosis = diagnoseStuck(projectId);
    if (!diagnosis) {
      stuckState.set(projectId, state);
      return;
    }

    const now = Date.now();
    const diagnosisChanged = state.lastDiagnosisKey !== diagnosis.code;
    if (diagnosisChanged || now - state.lastWarnedAt > STUCK_REWARN_MS) {
      log.warn(`[stuck] project ${projectId}: ${diagnosis.summary} (${state.emptyPollCount} empty polls)`);
      try {
        db.prepare(
          "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_warning', ?)",
        ).run(projectId, `🟡 자동 실행 정체: ${diagnosis.summary}`);
      } catch { /* best-effort */ }
      broadcast("autopilot:stuck", {
        projectId,
        code: diagnosis.code,
        summary: diagnosis.summary,
        emptyPollCount: state.emptyPollCount,
      });
      broadcast("project:updated", { projectId });
      state.lastWarnedAt = now;
      state.lastDiagnosisKey = diagnosis.code;
    }
    stuckState.set(projectId, state);
  }

  function getBusyAgents(projectId: string): Set<string> {
    if (!busyAgents.has(projectId)) busyAgents.set(projectId, new Set());
    return busyAgents.get(projectId)!;
  }

  function getPauseState(projectId: string) {
    if (!pauseState.has(projectId)) {
      pauseState.set(projectId, {
        paused: false,
        consecutiveRateLimits: 0,
        resumeTimer: null,
        nextRetryAt: null,
      });
    }
    return pauseState.get(projectId)!;
  }

  /**
   * Fix dangling assignee_ids — tasks assigned to agents that no longer exist.
   * Clears assignee so autoAssignUnassigned can reassign them.
   */
  function fixDanglingAssignees(projectId: string): void {
    const fixed = db.prepare(`
      UPDATE tasks SET assignee_id = NULL
      WHERE project_id = ? AND assignee_id IS NOT NULL
        AND status != 'done'
        AND assignee_id NOT IN (SELECT id FROM agents WHERE project_id = ?)
    `).run(projectId, projectId);

    if (fixed.changes > 0) {
      log.warn(`Fixed ${fixed.changes} tasks with dangling assignee in project ${projectId}`);
    }
  }

  /**
   * Auto-retry blocked tasks with escalation strategy:
   * 1. retry_count < MAX → same agent retry (after cooldown)
   * 2. retry_count >= MAX → reassign to a DIFFERENT agent, reset retry_count
   * 3. Already reassigned + retry exhausted again → give up (permanent blocked)
   *
   * Permanent blocked tasks are excluded from goal progress calculation
   * so the goal can still complete with the remaining tasks.
   */
  function retryBlockedTasks(projectId: string): void {
    const cooldownSeconds = Math.round(BLOCKED_RETRY_DELAY_MS / 1000);

    // Step 1: Retry tasks that still have attempts left (same agent)
    const retried = db.prepare(`
      UPDATE tasks SET status = 'todo', retry_count = retry_count + 1, updated_at = datetime('now')
      WHERE project_id = ? AND status = 'blocked' AND retry_count < ?
        AND updated_at <= datetime('now', '-${cooldownSeconds} seconds')
    `).run(projectId, MAX_TASK_RETRIES);

    if (retried.changes > 0) {
      log.info(`Auto-retried ${retried.changes} blocked tasks (same agent)`);
      broadcast("project:updated", { projectId });
    }

    // Step 2: Escalate — reassign retry-exhausted tasks to a different agent
    // Only if reassign_count < MAX_REASSIGNS (prevents infinite agent-switching loop)
    const exhausted = db.prepare(`
      SELECT t.id, t.assignee_id, t.title, t.reassign_count FROM tasks t
      WHERE t.project_id = ? AND t.status = 'blocked' AND t.retry_count >= ? AND t.reassign_count < ?
        AND t.updated_at <= datetime('now', '-${cooldownSeconds} seconds')
    `).all(projectId, MAX_TASK_RETRIES, MAX_REASSIGNS) as { id: string; assignee_id: string | null; title: string; reassign_count: number }[];

    if (exhausted.length === 0) return;

    // Get all available agents for reassignment
    const agents = db.prepare(
      "SELECT id, role FROM agents WHERE project_id = ?",
    ).all(projectId) as { id: string; role: string }[];

    if (agents.length <= 1) {
      // Only one agent — can't reassign, give up on these tasks
      for (const t of exhausted) {
        log.warn(`Task "${t.title}" permanently blocked — no alternative agent available`);
        db.prepare(
          "INSERT INTO activities (project_id, type, message) VALUES (?, 'task_skipped', ?)",
        ).run(projectId, `Permanently blocked (no alt agent): ${t.title}`);
      }
      // Update goal progress to exclude permanently blocked tasks
      updateGoalProgressExcludingBlocked(projectId);
      return;
    }

    let reassigned = 0;
    for (const t of exhausted) {
      // Find a different agent than the current assignee
      const altAgent = agents.find((a) => a.id !== t.assignee_id)
        ?? agents.find((a) => a.role !== "cto" && a.role !== "reviewer")
        ?? agents[0];

      if (!altAgent || altAgent.id === t.assignee_id) {
        // No alternative — permanently blocked
        log.warn(`Task "${t.title}" permanently blocked — no different agent`);
        db.prepare(
          "INSERT INTO activities (project_id, type, message) VALUES (?, 'task_skipped', ?)",
        ).run(projectId, `Permanently blocked: ${t.title}`);
        continue;
      }

      // Reassign + reset retry_count for fresh attempts with new agent
      db.prepare(`
        UPDATE tasks SET status = 'todo', assignee_id = ?, retry_count = 0,
          reassign_count = reassign_count + 1, updated_at = datetime('now')
        WHERE id = ? AND status = 'blocked'
      `).run(altAgent.id, t.id);

      db.prepare(
        "INSERT INTO activities (project_id, type, message) VALUES (?, 'task_reassigned', ?)",
      ).run(projectId, `Escalated "${t.title}" to different agent (retry exhausted)`);
      reassigned++;
    }

    if (reassigned > 0) {
      log.info(`Escalated ${reassigned} blocked tasks to different agents`);
      broadcast("project:updated", { projectId });
    }

    // Update goal progress for any permanently stuck tasks
    updateGoalProgressExcludingBlocked(projectId);
  }

  /**
   * Update goal progress for goals that have permanently blocked tasks.
   * Permanently blocked = blocked + retry exhausted + reassign exhausted.
   * These tasks are excluded from the denominator so the goal can still complete.
   */
  function updateGoalProgressExcludingBlocked(projectId: string): void {
    const goals = db.prepare(
      "SELECT DISTINCT goal_id FROM tasks WHERE project_id = ? AND status = 'blocked' AND retry_count >= ? AND reassign_count >= ?",
    ).all(projectId, MAX_TASK_RETRIES, MAX_REASSIGNS) as { goal_id: string }[];

    for (const { goal_id } of goals) {
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
          SUM(CASE WHEN status = 'blocked' AND retry_count >= ? AND reassign_count >= ? THEN 1 ELSE 0 END) as permanently_blocked
        FROM tasks WHERE goal_id = ? AND parent_task_id IS NULL
      `).get(MAX_TASK_RETRIES, MAX_REASSIGNS, goal_id) as { total: number; done: number; permanently_blocked: number };

      const effective = stats.total - stats.permanently_blocked;
      const progress = effective > 0 ? Math.round((stats.done / effective) * 100) : (stats.total === stats.permanently_blocked ? 100 : 0);
      db.prepare("UPDATE goals SET progress = ? WHERE id = ?").run(progress, goal_id);

      if (stats.permanently_blocked > 0) {
        log.warn(`Goal ${goal_id}: ${stats.permanently_blocked} tasks permanently blocked, progress based on ${effective} remaining tasks`);
      }
    }
  }

  /**
   * Auto-assign unassigned todo tasks to available agents.
   * Prefers worker agents, falls back to CTO/reviewer if no workers exist.
   */
  function autoAssignUnassigned(projectId: string): void {
    // First fix any dangling assignees from deleted agents
    fixDanglingAssignees(projectId);

    // Only auto-assign todo tasks (blocked tasks need human review)
    const unassigned = db.prepare(
      "SELECT id, title FROM tasks WHERE project_id = ? AND status = 'todo' AND assignee_id IS NULL",
    ).all(projectId) as { id: string; title: string }[];

    if (unassigned.length === 0) return;

    // Prefer worker agents, fall back to any agent if no workers
    let agents = db.prepare(
      "SELECT id, role FROM agents WHERE project_id = ? AND role NOT IN ('cto', 'reviewer')",
    ).all(projectId) as { id: string; role: string }[];

    if (agents.length === 0) {
      // Fallback: use any agent including CTO/reviewer — better than no execution
      agents = db.prepare(
        "SELECT id, role FROM agents WHERE project_id = ?",
      ).all(projectId) as { id: string; role: string }[];
    }

    if (agents.length === 0) {
      // Rate-limit warning to avoid spam: only log once per polling cycle
      log.warn(`Cannot auto-assign ${unassigned.length} task(s) in project ${projectId} — no agents available`);
      // Record activity so the user sees it in the UI (deduped by recent message)
      const lastWarn = db.prepare(
        "SELECT id FROM activities WHERE project_id = ? AND type = 'autopilot_warning' AND created_at > datetime('now', '-5 minutes') LIMIT 1"
      ).get(projectId) as { id: number } | undefined;
      if (!lastWarn) {
        db.prepare(
          "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_warning', ?)"
        ).run(projectId, `작업 ${unassigned.length}개를 자동 할당할 수 없습니다 — 에이전트가 없습니다. 에이전트를 추가해주세요.`);
        broadcast("project:updated", { projectId });
      }
      return;
    }

    // Role-aware round-robin: try to match task's original role hint first,
    // then fall back to round-robin across all available agents.
    const roleCount = new Map<string, number>();
    for (const task of unassigned) {
      // Try to recover a role hint from the task's previous assignee or description
      const taskDetail = db.prepare("SELECT description, title FROM tasks WHERE id = ?").get(task.id) as { description: string; title: string } | undefined;
      const titleLower = (taskDetail?.title ?? "").toLowerCase();

      // Heuristic: match role keywords in task title
      const roleHint = agents.find((a) => titleLower.includes(a.role))?.role;
      const roleAgents = roleHint
        ? agents.filter((a) => a.role === roleHint)
        : [];

      let agent;
      if (roleAgents.length > 0) {
        const count = roleCount.get(roleHint!) ?? 0;
        roleCount.set(roleHint!, count + 1);
        agent = roleAgents[count % roleAgents.length];
      } else {
        // Fallback: global round-robin
        const count = roleCount.get("__global__") ?? 0;
        roleCount.set("__global__", count + 1);
        agent = agents[count % agents.length];
      }

      db.prepare("UPDATE tasks SET assignee_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(agent.id, task.id);
    }

    log.info(`Auto-assigned ${unassigned.length} unassigned tasks in project ${projectId}`);
    broadcast("project:updated", { projectId });
  }

  /**
   * Pick next executable tasks — sequential goal processing.
   *
   * Goal-level sequencing: only ONE goal is active at a time within a project.
   *   1) If any goal already has in_progress/in_review tasks → that goal stays active
   *   2) Otherwise → highest-priority goal with todo tasks becomes active
   *   3) Tasks within the active goal can still run in parallel (up to maxSlots)
   *
   * This prevents the previous behavior where multiple goals' tasks would
   * interleave by global priority, making it hard to finish anything.
   */
  function pickNextTasks(projectId: string, maxSlots: number): any[] {
    if (maxSlots <= 0) return [];

    // Auto-retry blocked tasks that haven't exceeded retry limit
    retryBlockedTasks(projectId);

    // Recompute goal progress accounting for permanently-blocked tasks.
    // Previously this only fired from inside retryBlockedTasks when there were
    // retry-exhausted-but-reassignable tasks — so a goal that reached fully
    // permanent-blocked state never got its progress corrected and appeared
    // stuck at 67% forever. Idempotent + cheap; safe to run every poll.
    updateGoalProgressExcludingBlocked(projectId);

    // Then auto-assign any unassigned tasks
    autoAssignUnassigned(projectId);

    const busy = getBusyAgents(projectId);

    // Safety net: clean up "ghost" in_progress tasks whose runtime context was
    // lost (e.g., server killed without graceful shutdown, executeOne crashed
    // before transitioning the task). In sequential goal mode such a ghost
    // would pin a goal as active forever and block all other goals.
    //
    // Heuristic: an in_progress / in_review task is a ghost if its assignee is
    // NOT in the in-memory busyAgents set AND it has not been updated within
    // a generous window (3x task timeout). The window guard prevents racing
    // with a task that was just transitioned but hasn't been added to busy yet.
    const STALE_THRESHOLD_SECONDS = Math.ceil((TASK_TIMEOUT_MS * 3) / 1000);
    const staleCandidates = db.prepare(`
      SELECT id, assignee_id, status FROM tasks
      WHERE project_id = ?
        AND status IN ('in_progress', 'in_review')
        AND (strftime('%s', 'now') - strftime('%s', updated_at)) > ?
    `).all(projectId, STALE_THRESHOLD_SECONDS) as { id: string; assignee_id: string | null; status: string }[];
    for (const ghost of staleCandidates) {
      if (ghost.assignee_id && busy.has(ghost.assignee_id)) continue; // really running
      db.prepare("UPDATE tasks SET status = 'todo', updated_at = datetime('now') WHERE id = ?").run(ghost.id);
      log.warn(`Stale ${ghost.status} task ${ghost.id} reset to todo (no live runtime, idle > ${STALE_THRESHOLD_SECONDS}s)`);
      db.prepare(
        "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_warning', ?)"
      ).run(projectId, `중단된 작업 자동 복구: 진행 상태 → todo`);
    }

    // Step 1: identify the active goal (one at a time)
    const goalOrder = `
      CASE g.priority
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
        ELSE 4
      END ASC, g.sort_order ASC, g.created_at ASC
    `;

    // Prefer a goal that already has work in flight — never abandon mid-goal
    const startedGoal = db.prepare(`
      SELECT g.id FROM goals g
      WHERE g.project_id = ?
        AND EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.goal_id = g.id AND t.status IN ('in_progress', 'in_review')
        )
      ORDER BY ${goalOrder}
      LIMIT 1
    `).get(projectId) as { id: string } | undefined;

    let activeGoalId: string | undefined = startedGoal?.id;

    if (!activeGoalId) {
      // No goal in progress — pick the next highest-priority goal that has
      // ready (todo + assigned) tasks
      const nextGoal = db.prepare(`
        SELECT g.id FROM goals g
        WHERE g.project_id = ?
          AND EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.goal_id = g.id
              AND t.status = 'todo'
              AND t.assignee_id IS NOT NULL
          )
        ORDER BY ${goalOrder}
        LIMIT 1
      `).get(projectId) as { id: string } | undefined;
      activeGoalId = nextGoal?.id;
    }

    if (!activeGoalId) return [];

    // Step 2: pick tasks ONLY from the active goal
    // Sprint 5: status = 'todo' naturally excludes 'pending_approval' tasks.
    // pending_approval tasks must be explicitly approved (→ todo) via the
    // Approval Gate API before the scheduler picks them up.
    const candidates = db.prepare(`
      SELECT t.* FROM tasks t
      WHERE t.goal_id = ?
        AND t.status = 'todo'
        AND t.assignee_id IS NOT NULL
      ORDER BY
        CASE WHEN t.parent_task_id IS NOT NULL THEN 0 ELSE 1 END,
        t.sort_order ASC,
        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        t.created_at ASC
      LIMIT 20
    `).all(activeGoalId) as any[];

    // Reviewer/QA tasks should wait until all other tasks in the same goal are done
    const reviewerRoles = new Set(["qa-reviewer", "reviewer", "qa"]);
    const reviewerAgentIds = new Set(
      (db.prepare(
        "SELECT id FROM agents WHERE project_id = ? AND role IN ('qa-reviewer', 'reviewer', 'qa')"
      ).all(projectId) as { id: string }[]).map((a) => a.id)
    );

    // Filter out tasks whose agent is already busy, pick up to maxSlots
    const picked: any[] = [];
    const usedAgents = new Set(busy);
    for (const task of candidates) {
      if (picked.length >= maxSlots) break;
      if (usedAgents.has(task.assignee_id)) continue; // agent already occupied

      // Gate: reviewer tasks wait until all sibling tasks in the same goal are
      // done. Permanently-blocked siblings (retry + reassign both exhausted)
      // are treated as "done-for-gating-purposes" — otherwise the entire goal
      // halts forever on a single task the scheduler can no longer make
      // progress on, and the whole project sits idle waiting for a human.
      if (task.goal_id && reviewerAgentIds.has(task.assignee_id)) {
        const siblings = db.prepare(`
          SELECT COUNT(*) as remaining FROM tasks
          WHERE goal_id = ? AND id != ?
            AND status != 'done'
            AND NOT (status = 'blocked' AND retry_count >= ? AND reassign_count >= ?)
            AND assignee_id NOT IN (SELECT id FROM agents WHERE project_id = ? AND role IN ('qa-reviewer', 'reviewer', 'qa'))
        `).get(task.goal_id, task.id, MAX_TASK_RETRIES, MAX_REASSIGNS, projectId) as { remaining: number };

        if (siblings.remaining > 0) {
          logDeferOnce(task.id, task.title, siblings.remaining);
          continue;
        }
      }

      picked.push(task);
      usedAgents.add(task.assignee_id);
    }
    return picked;
  }

  /**
   * Non-blocking: check for unprocessed goals and process them in background.
   * Does NOT stop the queue — current todo tasks keep running.
   */
  function triggerGoalProcessingIfNeeded(projectId: string): void {
    const project = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(projectId) as { autopilot: string } | undefined;
    if (!project || (project.autopilot !== "goal" && project.autopilot !== "full")) return;

    // Sequential goal processing: do NOT decompose the next goal until ALL
    // tasks of the current in-progress goal are done or permanently blocked.
    // Without this guard, all goals get decomposed upfront — wasting tokens
    // on spec/decompose for goals whose scope may change based on earlier
    // goal results.
    const activeGoal = db.prepare(`
      SELECT g.id FROM goals g
      WHERE g.project_id = ?
        AND g.progress < 100
        AND (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id) > 0
        AND (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status NOT IN ('done', 'blocked')) > 0
      LIMIT 1
    `).get(projectId) as { id: string } | undefined;

    if (activeGoal) return; // wait for current goal to finish

    const nextGoal = db.prepare(`
      SELECT g.id FROM goals g
      WHERE g.project_id = ?
        AND (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id) = 0
      ORDER BY
        CASE g.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        g.sort_order ASC,
        g.created_at ASC
      LIMIT 1
    `).get(projectId) as { id: string } | undefined;

    if (nextGoal) {
      processNextGoal(projectId, nextGoal.id);
    }
  }

  /**
   * Check if the queue should auto-stop:
   * No todo, in_progress, pending_approval, or retryable blocked tasks remain.
   */
  function shouldAutoStop(projectId: string): boolean {
    const remaining = db.prepare(`
      SELECT COUNT(*) as cnt FROM tasks
      WHERE project_id = ?
        AND status IN ('todo', 'in_progress', 'pending_approval')
    `).get(projectId) as { cnt: number };

    if (remaining.cnt > 0) return false;

    // Check for blocked tasks that could still be retried
    const retryable = db.prepare(`
      SELECT COUNT(*) as cnt FROM tasks
      WHERE project_id = ?
        AND status = 'blocked'
        AND (retry_count < ? OR reassign_count < ?)
    `).get(projectId, MAX_TASK_RETRIES, MAX_REASSIGNS) as { cnt: number };

    if (retryable.cnt > 0) return false;

    return true;
  }

  /**
   * Process a SINGLE goal — spec → decompose → auto-approve.
   * Sequential pipeline: one goal at a time by priority.
   * After this goal's tasks complete, shouldAutoStop picks the next goal.
   */
  function processNextGoal(projectId: string, goalId: string): void {
    if (fullAutopilotLock.has(`process-${projectId}`)) return;
    fullAutopilotLock.add(`process-${projectId}`);

    const ctoAgent = db.prepare(
      "SELECT id FROM agents WHERE project_id = ? AND role = 'cto' LIMIT 1"
    ).get(projectId) as { id: string } | undefined;

    const setActivity = (activity: string) => {
      if (ctoAgent) {
        db.prepare("UPDATE agents SET status = 'working', current_activity = ? WHERE id = ?").run(activity, ctoAgent.id);
        broadcast("agent:status", { id: ctoAgent.id, status: "working", activity });
      }
    };
    const clearActivity = () => {
      if (ctoAgent) {
        db.prepare("UPDATE agents SET status = 'idle', current_activity = NULL WHERE id = ?").run(ctoAgent.id);
        broadcast("agent:status", { id: ctoAgent.id, status: "idle" });
      }
    };

    const goalRow = db.prepare("SELECT id, title FROM goals WHERE id = ?").get(goalId) as { id: string; title: string } | undefined;
    if (!goalRow) { fullAutopilotLock.delete(`process-${projectId}`); return; }
    const goalTitle = goalRow.title || goalId;

    const spec = db.prepare("SELECT prd_summary FROM goal_specs WHERE goal_id = ?").get(goalId) as { prd_summary: string } | undefined;
    const prd = spec?.prd_summary;
    const isGenerating = prd && prd.includes('"_status":"generating"');
    const hasSpec = prd && !isGenerating && !prd.includes('"_status":"failed"');

    if (isGenerating) {
      fullAutopilotLock.delete(`process-${projectId}`);
      scheduleNextPoll(projectId);
      return;
    }

    log.info(`Sequential pipeline: processing goal "${goalTitle}" (${goalId})`);

    (async () => {
      try {
        // Step 1: Generate spec if needed
        if (!hasSpec && generateGoalSpec) {
          setActivity(`spec_gen:${goalTitle.slice(0, 60)}`);
          db.prepare("INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot', ?)").run(
            projectId, `기획서 생성 중: "${goalTitle.slice(0, 60)}"`
          );
          broadcast("project:updated", { projectId });
          db.prepare(
            "INSERT OR REPLACE INTO goal_specs (goal_id, prd_summary, feature_specs, user_flow, acceptance_criteria, tech_considerations, generated_by) VALUES (?, '{\"_status\":\"generating\"}', '[]', '[]', '[]', '[]', 'ai')"
          ).run(goalId);
          await generateGoalSpec(goalId);
          broadcast("project:updated", { projectId });
        }

        // Step 2: Decompose
        setActivity(`decompose:${goalTitle.slice(0, 60)}`);
        db.prepare("INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot', ?)").run(
          projectId, `태스크 분할 중: "${goalTitle.slice(0, 60)}"`
        );
        broadcast("project:updated", { projectId });
        await engine.decomposeGoal(goalId);

        // Step 3: Auto-approve
        const project = db.prepare("SELECT autopilot FROM projects WHERE id = ?").get(projectId) as { autopilot: string } | undefined;
        if (project && (project.autopilot === "goal" || project.autopilot === "full")) {
          db.prepare("UPDATE tasks SET status = 'todo' WHERE goal_id = ? AND status = 'pending_approval'").run(goalId);
        }
        broadcast("project:updated", { projectId });

        // Resume queue — will pick up new tasks for THIS goal only
        if (!timers.has(projectId)) {
          busyAgents.set(projectId, new Set());
          pauseState.delete(projectId);
          timers.set(projectId, setTimeout(() => poll(projectId), 0));
        }
      } catch (err: any) {
        log.error(`Failed to process goal ${goalId}`, err);
        db.prepare("INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_error', ?)").run(
          projectId, `목표 처리 실패 "${goalTitle.slice(0, 40)}": ${err.message?.slice(0, 150)}`
        );
        broadcast("project:updated", { projectId });
      } finally {
        clearActivity();
        fullAutopilotLock.delete(`process-${projectId}`);
      }
    })();
  }

  function scheduleNextPoll(projectId: string): void {
    // Clear any existing timer before scheduling a new one. Without this,
    // code paths that call scheduleNextPoll twice in the same poll() cycle
    // (e.g. processNextGoal's isGenerating early-return path followed by
    // poll()'s own tail call at the end) leak orphan timers. Map.set only
    // replaces the map entry — the previous setTimeout handle stays live
    // and fires independently, doubling the timer count each poll cycle.
    // Left unchecked this grows exponentially and saturates the event loop.
    const existing = timers.get(projectId);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => poll(projectId), POLL_INTERVAL_MS);
    timers.set(projectId, handle);
  }

  function handleRateLimit(projectId: string): void {
    const state = getPauseState(projectId);
    state.consecutiveRateLimits++;
    state.paused = true;

    if (state.consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
      // Previously: stopQueueInternal() — completely stopped the queue and
      // required a human to click "run queue" again. That meant long-running
      // autopilot sessions silently died overnight the first time the Claude
      // Pro budget hit its window limit.
      //
      // New behaviour: enter a long cooldown (default 15 min), reset the
      // rate-limit counter when it expires, and auto-resume the queue.
      // The queue itself stays "alive" from the user's perspective — the
      // UI can surface "cooling down, resumes at HH:MM" without requiring
      // intervention.
      const retryAt = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS);
      state.nextRetryAt = retryAt;
      log.error(
        `Queue cooling down: ${state.consecutiveRateLimits} consecutive rate limits — long backoff ${RATE_LIMIT_COOLDOWN_MS / 60000}min for project ${projectId}`,
      );
      db.prepare(
        "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_warning', ?)",
      ).run(
        projectId,
        `Rate limit ${state.consecutiveRateLimits}회 연속 — ${Math.round(RATE_LIMIT_COOLDOWN_MS / 60000)}분 쿨다운 후 자동 재시도`,
      );
      broadcast("queue:paused", {
        projectId,
        reason: "rate_limit_cooldown",
        retryNumber: state.consecutiveRateLimits,
        maxRetries: MAX_CONSECUTIVE_RATE_LIMITS,
        nextRetryAt: retryAt.toISOString(),
        backoffMs: RATE_LIMIT_COOLDOWN_MS,
        message: `Rate limit ${state.consecutiveRateLimits}회 — ${Math.round(RATE_LIMIT_COOLDOWN_MS / 60000)}분 후 자동 재시도`,
      });

      // Cancel any short-backoff resume timer that may still be pending
      if (state.resumeTimer) clearTimeout(state.resumeTimer);
      state.resumeTimer = setTimeout(() => {
        state.paused = false;
        state.nextRetryAt = null;
        state.consecutiveRateLimits = 0; // full reset after cooldown
        log.info(`Queue resumed after rate-limit cooldown for project ${projectId}`);
        db.prepare(
          "INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot', ?)",
        ).run(projectId, `쿨다운 종료 — 큐 자동 재개`);
        broadcast("queue:resumed", { projectId });
        if (timers.has(projectId)) {
          poll(projectId);
        } else {
          // Queue was fully stopped somewhere else (e.g. shutdown). Start
          // it again inline — same logic as the exported startQueue.
          log.info(`Rate-limit cooldown over but timers cleared, restarting queue for ${projectId}`);
          busyAgents.set(projectId, new Set());
          pauseState.delete(projectId);
          timers.set(projectId, setTimeout(() => poll(projectId), 0));
        }
      }, RATE_LIMIT_COOLDOWN_MS);
      return;
    }

    const backoffMs = Math.min(
      BACKOFF_BASE_MS * Math.pow(2, state.consecutiveRateLimits - 1),
      BACKOFF_MAX_MS,
    );
    const retryAt = new Date(Date.now() + backoffMs);
    state.nextRetryAt = retryAt;

    log.warn(`Queue paused: rate limit (${state.consecutiveRateLimits}/${MAX_CONSECUTIVE_RATE_LIMITS}), retry in ${backoffMs / 1000}s`);

    broadcast("queue:paused", {
      projectId,
      reason: "rate_limit",
      retryNumber: state.consecutiveRateLimits,
      maxRetries: MAX_CONSECUTIVE_RATE_LIMITS,
      nextRetryAt: retryAt.toISOString(),
      backoffMs,
    });

    state.resumeTimer = setTimeout(() => {
      state.paused = false;
      state.nextRetryAt = null;
      log.info(`Queue resumed after backoff for project ${projectId}`);
      broadcast("queue:resumed", { projectId });
      if (timers.has(projectId)) poll(projectId);
    }, backoffMs);
  }

  function stopQueueInternal(projectId: string): void {
    const handle = timers.get(projectId);
    if (handle !== undefined) clearTimeout(handle);
    timers.delete(projectId);

    const state = getPauseState(projectId);
    if (state.resumeTimer) clearTimeout(state.resumeTimer);
    pauseState.delete(projectId);
  }

  /** Execute a single task, handling completion and delegation. */
  async function executeOne(projectId: string, task: any): Promise<void> {
    const busy = getBusyAgents(projectId);
    busy.add(task.assignee_id);
    const state = getPauseState(projectId);

    log.info(`Scheduler: executing "${task.title}" via agent ${task.assignee_id}`);

    try {
      const result = await engine.executeTask(task.id);
      broadcast("task:updated", { taskId: task.id, ...result });

      // Success — reset rate limit counter
      state.consecutiveRateLimits = 0;

      if (task.parent_task_id) {
        delegationEngine.checkParentCompletion(task.parent_task_id);
      }
    } catch (err: any) {
      const isRateLimit = err.message?.toLowerCase().includes("rate limit") ||
        err.message?.toLowerCase().includes("429") ||
        err.message?.toLowerCase().includes("too many requests");

      if (isRateLimit) {
        handleRateLimit(projectId);
      } else {
        // CRITICAL: if engine.executeTask threw BEFORE calling
        // transitionTask(in_progress) — e.g. an architect-phase failure — the
        // task is still `todo` in the DB. Without explicitly marking it
        // failed here, the very next poll picks the same task, runs architect
        // again, fails the same way, and we spin forever (the infinite
        // architect_started loop we observed 10:18~10:21). Retry budget is
        // owned by the blocked→retry promotion path in pickNextTasks, not by
        // the caller, so we set blocked + bump retry_count so the loop can
        // actually exit on its own.
        const actual = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id) as
          | { status: string }
          | undefined;
        if (actual && (actual.status === "todo" || actual.status === "in_progress")) {
          db.prepare(
            "UPDATE tasks SET status = 'blocked', retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?",
          ).run(task.id);
          db.prepare(
            "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'task_blocked', ?)",
          ).run(
            projectId,
            task.assignee_id,
            `작업 실패 → blocked: "${(task.title ?? "").slice(0, 80)}" — ${(err.message ?? "").slice(0, 200)}`,
          );
        }
        const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id);
        broadcast("task:updated", updated ?? { taskId: task.id, status: "blocked", error: err.message });
        log.error(`Scheduler: task "${task.title}" failed`, err);

        if (task.parent_task_id) {
          delegationEngine.checkParentCompletion(task.parent_task_id);
        }
      }
    } finally {
      busy.delete(task.assignee_id);
      // Trigger next poll to fill the freed slot — cancel existing timer to avoid double-poll
      if (timers.has(projectId) && !getPauseState(projectId).paused) {
        const existing = timers.get(projectId);
        if (existing) clearTimeout(existing);
        timers.set(projectId, setTimeout(() => poll(projectId), 100)); // near-immediate
      }
    }
  }

  async function poll(projectId: string): Promise<void> {
    if (!timers.has(projectId)) return;

    const state = getPauseState(projectId);
    if (state.paused) {
      // paused 상태에서는 poll 재등록하지 않음 — resumeTimer 만료 시 자동 재개
      return;
    }

    const busy = getBusyAgents(projectId);
    const availableSlots = DEFAULT_MAX_CONCURRENCY - busy.size;

    if (availableSlots <= 0) {
      // All slots occupied — wait for a task to finish
      scheduleNextPoll(projectId);
      return;
    }

    const tasks = pickNextTasks(projectId, availableSlots);

    // Surface stuck state: if we keep polling with nothing executable but
    // there IS outstanding work, the user needs to know why. Only count
    // as "stuck" when NOTHING is running — when busy.size > 0, empty picks
    // are normal (remaining tasks may need the same agent or be gated on
    // the currently running one).
    if (busy.size === 0) {
      checkStuckState(projectId, tasks.length);
    } else {
      stuckState.delete(projectId);
    }

    if (tasks.length === 0) {
      // No tasks to pick — try to process unhandled goals in background (non-blocking)
      triggerGoalProcessingIfNeeded(projectId);

      // Check if queue should auto-stop
      if (busy.size === 0 && shouldAutoStop(projectId)) {
        log.info(`Queue auto-stopped for project ${projectId} — no remaining work`);
        stopQueueInternal(projectId);
        broadcast("queue:stopped", { projectId, reason: "completed" });

        // Full autopilot: generate new goals when all work is done
        const project = db.prepare("SELECT autopilot, mission FROM projects WHERE id = ?").get(projectId) as { autopilot: string; mission: string } | undefined;
        if (project?.autopilot === "full" && project.mission?.trim()) {
          // Prevent duplicate triggers
          if (fullAutopilotLock.has(projectId)) {
            log.info(`Full autopilot: already running for ${projectId}, skipping`);
            return;
          }

          const activeGoals = db.prepare(
            "SELECT COUNT(*) as count FROM goals g WHERE g.project_id = ? AND (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status NOT IN ('done','blocked')) > 0",
          ).get(projectId) as { count: number };

          if (activeGoals.count === 0) {
            fullAutopilotLock.add(projectId);
            log.info(`Full autopilot: all goals complete for project ${projectId}, generating new goals`);

            // Generate goals only — spec/decompose handled by processNextGoal (sequential pipeline)
            (async () => {
              try {
                const { goalIds } = await engine.generateGoalsFromMission(projectId);
                fullAutopilotLock.delete(projectId);

                if (goalIds.length === 0) {
                  log.info("Full autopilot: no more goals to generate, notifying user");
                  db.prepare("INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot', ?)").run(
                    projectId, "모든 목표가 완료되었습니다. 새로운 목표를 생성하지 못했습니다 — 미션을 업데이트하거나 직접 목표를 추가해주세요."
                  );
                  broadcast("project:updated", { projectId });
                  broadcast("autopilot:idle", { projectId, reason: "no_new_goals" });
                  return;
                }

                broadcast("project:updated", { projectId });

                // Restart queue — shouldAutoStop will find unprocessed goals
                // and processNextGoal will handle them one by one in priority order
                if (!timers.has(projectId)) {
                  busyAgents.set(projectId, new Set());
                  pauseState.delete(projectId);
                  timers.set(projectId, setTimeout(() => poll(projectId), 0));
                  log.info(`Full autopilot: restarted queue with ${goalIds.length} new goals`);
                }
              } catch (err: any) {
                fullAutopilotLock.delete(projectId);
                log.error(`Full autopilot: goal generation failed for ${projectId}`, err);
                db.prepare("INSERT INTO activities (project_id, type, message) VALUES (?, 'autopilot_error', ?)").run(
                  projectId, `자동 목표 생성에 실패했습니다: ${err.message?.slice(0, 200)}`
                );
                broadcast("project:updated", { projectId });
                broadcast("autopilot:idle", { projectId, reason: "generation_failed" });
              }
            })();
          }
        }

        return;
      }
      scheduleNextPoll(projectId);
      return;
    }

    // Launch all picked tasks in parallel (fire-and-forget, each manages its own lifecycle)
    for (const task of tasks) {
      executeOne(projectId, task); // intentionally not awaited
    }

    // Schedule next poll to check for more tasks
    scheduleNextPoll(projectId);
  }

  return {
    startQueue(projectId: string): void {
      if (timers.has(projectId)) {
        log.warn(`Queue already running for project ${projectId}`);
        return;
      }
      log.info(`Starting queue for project ${projectId} (max concurrency: ${DEFAULT_MAX_CONCURRENCY})`);
      busyAgents.set(projectId, new Set());
      pauseState.delete(projectId);
      timers.set(projectId, setTimeout(() => poll(projectId), 0));
    },

    stopQueue(projectId: string): void {
      stopQueueInternal(projectId);
      log.info(`Stopped queue for project ${projectId}`);
    },

    isRunning(projectId: string): boolean {
      return timers.has(projectId);
    },

    isPaused(projectId: string): boolean {
      return getPauseState(projectId).paused;
    },

    resumeQueue(projectId: string): void {
      const state = getPauseState(projectId);
      if (!state.paused) return;

      if (state.resumeTimer) clearTimeout(state.resumeTimer);
      state.paused = false;
      state.consecutiveRateLimits = 0;
      state.nextRetryAt = null;

      log.info(`Queue manually resumed for project ${projectId}`);
      broadcast("queue:resumed", { projectId });

      // If timers were cleared while paused (e.g. after a stopQueue), schedule a
      // fresh poll so the queue actually resumes work.
      if (!timers.has(projectId)) {
        timers.set(projectId, setTimeout(() => poll(projectId), 0));
      } else {
        poll(projectId);
      }
    },

    getQueueState(projectId: string): QueueState {
      const state = getPauseState(projectId);
      return {
        running: timers.has(projectId),
        paused: state.paused,
        activeTasks: getBusyAgents(projectId).size,
        maxConcurrency: DEFAULT_MAX_CONCURRENCY,
        rateLimitRetries: state.consecutiveRateLimits,
        nextRetryAt: state.nextRetryAt?.toISOString() ?? null,
      };
    },

    setSpecGenerator(fn: (goalId: string) => Promise<any>): void {
      generateGoalSpec = fn;
    },
  };
}
