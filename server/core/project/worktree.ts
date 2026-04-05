import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("worktree");

export interface WorktreeInfo {
  path: string;
  branch: string;
}

/**
 * 에이전트별 독립 worktree 생성.
 *
 * 구조: {projectWorkdir}/.nova-worktrees/{agentSlug}-{taskSlug}-{uid}/
 * Branch: agent/{agentSlug}/{taskSlug}-{uid}
 *
 * Fallback: git repo가 아니면 null 반환 → 호출자가 직접 실행 모드로 전환
 */
export function createWorktree(
  projectWorkdir: string,
  agentName: string,
  taskSlug: string,
): WorktreeInfo | null {
  // git repo 확인
  if (!existsSync(join(projectWorkdir, ".git"))) {
    log.info("Not a git repo — skipping worktree isolation");
    return null;
  }

  const agentSlug = slugify(agentName).slice(0, 50) || "agent";
  const safeTaskSlug = slugify(taskSlug).slice(0, 40) || "task";
  const uid = randomBytes(4).toString("hex"); // 유일성 보장 — slug 충돌 방지
  const branch = `agent/${agentSlug}/${safeTaskSlug}-${uid}`;
  const worktreePath = join(projectWorkdir, ".nova-worktrees", `${agentSlug}-${safeTaskSlug}-${uid}`);

  // uid가 유일성을 보장하므로 충돌 없음 — 직접 생성
  const result = spawnSync("git", ["worktree", "add", "-b", branch, worktreePath], {
    cwd: projectWorkdir,
    stdio: "pipe",
    timeout: 30_000,
  });

  if (result.status !== 0) {
    // branch가 이미 존재할 수 있음 — 기존 branch 사용
    const retryResult = spawnSync("git", ["worktree", "add", worktreePath, branch], {
      cwd: projectWorkdir,
      stdio: "pipe",
      timeout: 30_000,
    });
    if (retryResult.status !== 0) {
      log.error(`Failed to create worktree: ${retryResult.stderr?.toString()}`);
      return null; // fallback to direct execution
    }
  }

  log.info(`Created worktree: ${worktreePath} (branch: ${branch})`);
  return { path: worktreePath, branch };
}

/**
 * Worktree 디렉토리 + branch 정리.
 * branch 파라미터가 있으면 worktree 제거 후 branch도 삭제.
 */
export function removeWorktree(projectWorkdir: string, worktreePath: string, branch?: string): void {
  // 1. worktree 제거
  try {
    spawnSync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: projectWorkdir,
      stdio: "pipe",
      timeout: 15_000,
    });
    log.info(`Removed worktree: ${worktreePath}`);
  } catch (err: any) {
    log.warn(`Failed to remove worktree: ${err.message}`);
  }

  // 2. branch 정리 (merge 완료된 경우 -d, 아니면 -D force)
  if (branch) {
    try {
      // 먼저 soft delete 시도 (merge된 branch만)
      const result = spawnSync("git", ["branch", "-d", branch], {
        cwd: projectWorkdir,
        stdio: "pipe",
        timeout: 10_000,
      });
      if (result.status === 0) {
        log.info(`Deleted branch: ${branch}`);
      } else {
        // merge 안된 branch — force delete
        const forceResult = spawnSync("git", ["branch", "-D", branch], {
          cwd: projectWorkdir,
          stdio: "pipe",
          timeout: 10_000,
        });
        if (forceResult.status === 0) {
          log.info(`Force-deleted unmerged branch: ${branch}`);
        } else {
          log.warn(`Failed to delete branch ${branch}: ${forceResult.stderr?.toString()}`);
        }
      }
    } catch (err: any) {
      log.warn(`Failed to delete branch ${branch}: ${err.message}`);
    }
  }
}

/**
 * 서버 시작 시 잔존 worktree + agent branch 일괄 정리.
 * recovery.ts에서 호출.
 */
export function cleanupStaleWorktrees(projectWorkdir: string): number {
  if (!existsSync(join(projectWorkdir, ".git"))) return 0;

  let cleaned = 0;
  const worktrees = listWorktrees(projectWorkdir);
  const mainWorktree = projectWorkdir;

  for (const wt of worktrees) {
    if (wt === mainWorktree) continue; // main worktree는 건드리지 않음
    if (wt.includes(".nova-worktrees")) {
      removeWorktree(projectWorkdir, wt);
      cleaned++;
    }
  }

  // 잔존 agent/* branch 정리
  try {
    const result = spawnSync("git", ["branch", "--list", "agent/*"], {
      cwd: projectWorkdir,
      stdio: "pipe",
      timeout: 10_000,
    });
    if (result.status === 0) {
      const branches = result.stdout.toString().split("\n")
        .map(b => b.trim())
        .filter(b => b && b.startsWith("agent/"));
      for (const b of branches) {
        spawnSync("git", ["branch", "-D", b], { cwd: projectWorkdir, stdio: "pipe", timeout: 5_000 });
        log.info(`Cleaned up stale branch: ${b}`);
        cleaned++;
      }
    }
  } catch { /* best effort */ }

  if (cleaned > 0) log.info(`Cleaned up ${cleaned} stale worktrees/branches in ${projectWorkdir}`);
  return cleaned;
}

export function listWorktrees(projectWorkdir: string): string[] {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: projectWorkdir,
    stdio: "pipe",
    timeout: 10_000,
  });
  if (result.status !== 0) return [];
  return result.stdout
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.replace("worktree ", ""));
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
