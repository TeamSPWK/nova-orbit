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

export function removeWorktree(projectWorkdir: string, worktreePath: string): void {
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
