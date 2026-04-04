import type { Database } from "better-sqlite3";
import type { SessionManager } from "../agent/session.js";
import { createOrchestrationEngine } from "./engine.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("scheduler");

const POLL_INTERVAL_MS = 5000;

export interface Scheduler {
  startQueue: (projectId: string) => void;
  stopQueue: (projectId: string) => void;
  isRunning: (projectId: string) => boolean;
}

/**
 * Priority-based task scheduler.
 *
 * - Polls for 'todo' tasks with an assigned agent.
 * - Executes tasks in priority order: critical > high > medium > low,
 *   then by created_at (FIFO within the same priority).
 * - Max 1 concurrent task per project to avoid overwhelming Claude sessions.
 * - After a task completes, auto-starts the next queued task.
 */
export function createScheduler(
  db: Database,
  sessionManager: SessionManager,
  broadcast: (event: string, data: unknown) => void,
): Scheduler {
  const engine = createOrchestrationEngine(db, sessionManager, broadcast);

  // projectId → timer handle (undefined means stopped)
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  // projectId → whether a task is actively running
  const running = new Map<string, boolean>();

  function pickNextTask(projectId: string): any | null {
    const PRIORITY_ORDER = "CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END";
    return db.prepare(`
      SELECT * FROM tasks
      WHERE project_id = ?
        AND status = 'todo'
        AND assignee_id IS NOT NULL
      ORDER BY ${PRIORITY_ORDER}, created_at ASC
      LIMIT 1
    `).get(projectId) ?? null;
  }

  function scheduleNextPoll(projectId: string): void {
    const handle = setTimeout(() => poll(projectId), POLL_INTERVAL_MS);
    timers.set(projectId, handle);
  }

  async function poll(projectId: string): Promise<void> {
    // Queue was stopped while waiting
    if (!timers.has(projectId)) return;

    // Another task is still running for this project
    if (running.get(projectId)) {
      scheduleNextPoll(projectId);
      return;
    }

    const task = pickNextTask(projectId);
    if (!task) {
      // No tasks pending — keep polling in case new tasks arrive
      scheduleNextPoll(projectId);
      return;
    }

    running.set(projectId, true);
    log.info(`Scheduler: executing task "${task.title}" (${task.priority}) for project ${projectId}`);

    try {
      const result = await engine.executeTask(task.id);
      broadcast("task:updated", { taskId: task.id, ...result });
    } catch (err: any) {
      broadcast("task:updated", { taskId: task.id, status: "blocked", error: err.message });
      log.error(`Scheduler: task "${task.title}" failed`, err);
    } finally {
      running.set(projectId, false);
      // Auto-start next task immediately after completion (no wait)
      if (timers.has(projectId)) {
        poll(projectId);
      }
    }
  }

  return {
    startQueue(projectId: string): void {
      if (timers.has(projectId)) {
        log.warn(`Queue already running for project ${projectId}`);
        return;
      }
      log.info(`Starting queue for project ${projectId}`);
      running.set(projectId, false);
      // Set a placeholder so the queue is considered "active"
      timers.set(projectId, setTimeout(() => poll(projectId), 0));
    },

    stopQueue(projectId: string): void {
      const handle = timers.get(projectId);
      if (handle !== undefined) {
        clearTimeout(handle);
      }
      timers.delete(projectId);
      log.info(`Stopped queue for project ${projectId}`);
    },

    isRunning(projectId: string): boolean {
      return timers.has(projectId);
    },
  };
}
