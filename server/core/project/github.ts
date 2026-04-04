import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyzeProject } from "./analyzer.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("github");

export interface GitHubConnectResult {
  localPath: string;
  repoUrl: string;
  branch: string;
  analysis: ReturnType<typeof analyzeProject>;
}

/**
 * Clone a GitHub repo and analyze it.
 * Uses the user's local git config for authentication (no separate tokens needed).
 */
export function connectGitHub(
  repoUrl: string,
  dataDir: string,
): GitHubConnectResult {
  // Validate URL
  const normalized = normalizeGitUrl(repoUrl);
  if (!normalized) {
    throw new Error("Invalid GitHub URL. Expected: https://github.com/owner/repo or owner/repo");
  }

  // Determine clone target directory
  const repoName = normalized.split("/").pop()?.replace(/\.git$/, "") ?? "repo";
  const cloneDir = resolve(dataDir, "repos", repoName);

  if (existsSync(cloneDir)) {
    // Already cloned — pull latest
    log.info(`Repo already exists, pulling latest: ${cloneDir}`);
    try {
      execSync("git pull --ff-only", { cwd: cloneDir, stdio: "pipe", timeout: 30000 });
    } catch {
      log.warn("git pull failed, continuing with existing state");
    }
  } else {
    // Clone
    mkdirSync(join(dataDir, "repos"), { recursive: true });
    log.info(`Cloning ${normalized} to ${cloneDir}`);
    try {
      execSync(`git clone --depth 50 ${normalized} ${cloneDir}`, {
        stdio: "pipe",
        timeout: 60000,
      });
    } catch (err: any) {
      throw new Error(`git clone failed: ${err.stderr?.toString() ?? err.message}`);
    }
  }

  // Get current branch
  let branch = "main";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: cloneDir,
      encoding: "utf-8",
    }).trim();
  } catch {
    // Fallback to main
  }

  // Analyze the cloned project
  const analysis = analyzeProject(cloneDir);

  log.info(`GitHub connected: ${repoName} (${branch})`, {
    languages: analysis.techStack.languages,
    agents: analysis.suggestedAgents.length,
  });

  return {
    localPath: cloneDir,
    repoUrl: normalized,
    branch,
    analysis,
  };
}

/**
 * Normalize various GitHub URL formats to https:// clone URL.
 */
function normalizeGitUrl(input: string): string | null {
  const trimmed = input.trim();

  // owner/repo shorthand
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }

  // https://github.com/owner/repo[.git]
  const httpsMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/,
  );
  if (httpsMatch) {
    const path = httpsMatch[1].replace(/\.git$/, "");
    return `https://github.com/${path}.git`;
  }

  // git@github.com:owner/repo.git
  const sshMatch = trimmed.match(
    /^git@github\.com:([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/,
  );
  if (sshMatch) {
    const path = sshMatch[1].replace(/\.git$/, "");
    return `https://github.com/${path}.git`;
  }

  return null;
}
