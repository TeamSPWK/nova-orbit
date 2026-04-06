import type { Database } from "better-sqlite3";
import type { SessionManager } from "../agent/session.js";
import { createOrchestrationEngine } from "./engine.js";
import { createDelegationEngine } from "./delegation.js";
import { createLogger } from "../../utils/logger.js";
import {
  POLL_INTERVAL_MS, BACKOFF_BASE_MS, BACKOFF_MAX_MS,
  MAX_CONSECUTIVE_RATE_LIMITS, DEFAULT_MAX_CONCURRENCY,
  MAX_TASK_RETRIES, MAX_REASSIGNS, BLOCKED_RETRY_DELAY_MS,
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
): Scheduler {
  const engine = createOrchestrationEngine(db, sessionManager, broadcast);
  const delegationEngine = createDelegationEngine(db, sessionManager, broadcast);

  // projectId → timer handle
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

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
        AND status NOT IN ('done', 'verified')
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

    if (agents.length === 0) return;

    // Round-robin assignment among available agents
    for (let i = 0; i < unassigned.length; i++) {
      const agent = agents[i % agents.length];
      db.prepare("UPDATE tasks SET assignee_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(agent.id, unassigned[i].id);
    }

    log.info(`Auto-assigned ${unassigned.length} unassigned tasks in project ${projectId}`);
    broadcast("project:updated", { projectId });
  }

  /**
   * Pick next executable tasks — returns multiple tasks for parallel execution.
   * Skips tasks whose assignee is already busy.
   */
  function pickNextTasks(projectId: string, maxSlots: number): any[] {
    if (maxSlots <= 0) return [];

    // Auto-retry blocked tasks that haven't exceeded retry limit
    retryBlockedTasks(projectId);

    // Then auto-assign any unassigned tasks
    autoAssignUnassigned(projectId);

    const busy = getBusyAgents(projectId);

    // Sprint 5: status = 'todo' naturally excludes 'pending_approval' tasks.
    // pending_approval tasks must be explicitly approved (→ todo) via the Approval Gate API
    // before the scheduler picks them up.
    const candidates = db.prepare(`
      SELECT t.* FROM tasks t
      LEFT JOIN goals g ON t.goal_id = g.id
      WHERE t.project_id = ?
        AND t.status = 'todo'
        AND t.assignee_id IS NOT NULL
      ORDER BY
        CASE WHEN t.parent_task_id IS NOT NULL THEN 0 ELSE 1 END,
        t.sort_order ASC,
        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        CASE g.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        t.created_at ASC
      LIMIT 20
    `).all(projectId) as any[];

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

      // Gate: reviewer tasks wait until all sibling tasks in the same goal are done
      if (task.goal_id && reviewerAgentIds.has(task.assignee_id)) {
        const siblings = db.prepare(`
          SELECT COUNT(*) as remaining FROM tasks
          WHERE goal_id = ? AND id != ? AND status NOT IN ('done', 'verified')
            AND assignee_id NOT IN (SELECT id FROM agents WHERE project_id = ? AND role IN ('qa-reviewer', 'reviewer', 'qa'))
        `).get(task.goal_id, task.id, projectId) as { remaining: number };

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

    return retryable.cnt === 0;
  }

  function scheduleNextPoll(projectId: string): void {
    const handle = setTimeout(() => poll(projectId), POLL_INTERVAL_MS);
    timers.set(projectId, handle);
  }

  function handleRateLimit(projectId: string): void {
    const state = getPauseState(projectId);
    state.consecutiveRateLimits++;
    state.paused = true;

    if (state.consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
      log.error(`Queue stopped: ${state.consecutiveRateLimits} consecutive rate limits for project ${projectId}`);
      stopQueueInternal(projectId);
      broadcast("queue:stopped", {
        projectId,
        reason: "rate_limit_exceeded",
        consecutiveFailures: state.consecutiveRateLimits,
        message: `Rate limit ${state.consecutiveRateLimits}회 연속 발생 — 큐가 정지되었습니다.`,
      });
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
        // Read actual DB state — engine may have set status to 'todo' (rate-limit) or 'blocked'
        const actual = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id);
        broadcast("task:updated", actual ?? { taskId: task.id, status: "blocked", error: err.message });
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

    if (tasks.length === 0) {
      // No tasks to pick — check if queue should auto-stop
      if (busy.size === 0 && shouldAutoStop(projectId)) {
        log.info(`Queue auto-stopped for project ${projectId} — no remaining work`);
        stopQueueInternal(projectId);
        broadcast("queue:stopped", { projectId, reason: "completed" });
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

      if (timers.has(projectId)) poll(projectId);
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
  };
}
