import type { Database } from "better-sqlite3";
import { createLogger } from "../utils/logger.js";
import { cleanupStaleWorktrees } from "./project/worktree.js";

const log = createLogger("recovery");

export interface RecoveryResult {
  recoveredTasks: number;
  killedProcesses: number;
}

export function recoverOnStartup(db: Database): RecoveryResult {
  let recoveredTasks = 0;
  let killedProcesses = 0;

  // 1. in_progress / in_review 태스크 → todo로 복원 (크래시로 중단된 작업)
  const stale = db
    .prepare(
      "UPDATE tasks SET status = 'todo', updated_at = datetime('now') WHERE status IN ('in_progress', 'in_review')",
    )
    .run();
  recoveredTasks = stale.changes;

  // 2. 고아 프로세스 정리: active 세션 중 pid가 있는 항목 확인 후 SIGTERM
  const activeSessions = db
    .prepare("SELECT id, agent_id, pid FROM sessions WHERE status = 'active' AND pid IS NOT NULL")
    .all() as { id: string; agent_id: string; pid: number }[];

  for (const s of activeSessions) {
    try {
      process.kill(s.pid, 0); // 존재 확인
      process.kill(s.pid, "SIGTERM");
      killedProcesses++;
      log.info(`Killed orphan process pid=${s.pid} (session ${s.id})`);
      db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE id = ?").run(s.id);
    } catch (err: any) {
      if (err.code === "ESRCH") {
        // 이미 종료된 프로세스 — DB 정리만
        db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE id = ?").run(s.id);
      } else if (err.code === "EPERM") {
        // 권한 부족 — 프로세스가 살아있지만 kill 불가
        log.warn(`Cannot kill orphan pid=${s.pid} (EPERM) — process owned by another user. Session left as active.`);
        // DB를 active로 유지 — 다음 시작 시 재시도
      } else {
        log.error(`Unexpected error killing pid=${s.pid}: ${err.message}`);
        db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE id = ?").run(s.id);
      }
    }
  }

  // pid=NULL인 stale active 세션도 정리
  db.prepare("UPDATE sessions SET status = 'killed', ended_at = datetime('now') WHERE status = 'active' AND pid IS NULL").run();

  // 3. 에이전트 상태 초기화: working → idle, current_task_id 해제
  db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE status = 'working'").run();

  // 4. 잔존 worktree + agent branch 정리 (프로젝트별)
  let cleanedWorktrees = 0;
  try {
    const projects = db.prepare("SELECT workdir FROM projects WHERE status = 'active' AND workdir != ''").all() as { workdir: string }[];
    for (const p of projects) {
      cleanedWorktrees += cleanupStaleWorktrees(p.workdir);
    }
  } catch (err: any) {
    log.warn(`Worktree cleanup failed: ${err.message}`);
  }

  if (recoveredTasks > 0 || killedProcesses > 0 || cleanedWorktrees > 0) {
    log.info(`Recovery complete: ${recoveredTasks} tasks restored, ${killedProcesses} orphan processes killed, ${cleanedWorktrees} stale worktrees cleaned`);
  }

  return { recoveredTasks, killedProcesses };
}
