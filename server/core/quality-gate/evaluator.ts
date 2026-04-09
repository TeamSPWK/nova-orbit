import type { Database } from "better-sqlite3";
import { spawnSync } from "node:child_process";
import type { SessionManager } from "../agent/session.js";
import { parseStreamJson } from "../agent/adapters/stream-parser.js";
import { createLogger } from "../../utils/logger.js";
import { createNovaRulesEngine } from "../nova-rules/index.js";
import type { VerificationResult, VerificationScope, Verdict, Severity, Score, VerificationIssue } from "../../../shared/types.js";

const log = createLogger("quality-gate");

export interface QualityGateConfig {
  scope: VerificationScope;
  maxRetries: number;
}

const DEFAULT_CONFIG: QualityGateConfig = {
  scope: "standard",
  maxRetries: 1,
};

/**
 * Nova Quality Gate — Generator-Evaluator Separation
 *
 * Core principle: The agent that implements (Generator) and the agent that
 * verifies (Evaluator) are ALWAYS different sessions. This prevents the
 * "marking your own homework" anti-pattern.
 *
 * 5-Dimension Verification (ported from Nova):
 * 1. Functionality — Does the code do what was requested?
 * 2. Data Flow — Input → Save → Load → Display complete?
 * 3. Design Alignment — Matches existing architecture?
 * 4. Craft — Error handling, type safety, edge cases?
 * 5. Edge Cases — Boundary values (0, negative, empty, max) safe?
 *
 * Severity Classification:
 * - auto-resolve: Revertible without external state change
 * - soft-block: Continuing possible but runtime failure risk
 * - hard-block: Data loss/security/irreversible — STOP immediately
 */
export function createQualityGate(
  db: Database,
  sessionManager: SessionManager,
  broadcast: (event: string, data: unknown) => void = () => {},
) {
  return {
    /**
     * Verify a completed task using an independent Evaluator session.
     * The Evaluator has NO context from the Generator — it reads the code fresh.
     */
    async verify(
      taskId: string,
      config: Partial<QualityGateConfig> & { workdir?: string } = {},
    ): Promise<VerificationResult> {
      const opts = { ...DEFAULT_CONFIG, ...config };
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
      if (!task) throw new Error(`Task ${taskId} not found`);

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(task.project_id) as any;
      if (!project) throw new Error(`Project ${task.project_id} not found`);

      log.info(`Starting verification for task "${task.title}" [scope: ${opts.scope}]`);

      // Collect a git diff snapshot of what the Generator actually changed.
      // This closes the "scope misread" gap from the Pulsar incident: the
      // evaluator previously had no way to notice when an agent created a
      // vanilla-JS `dashboard/` directory instead of editing `web/src/app/page.tsx`.
      const diffSummary = collectDiffSummary(config.workdir || project.workdir);

      // Build evaluation prompt
      const evaluationPrompt = buildEvaluationPrompt(task, project, opts.scope, diffSummary);

      // Spawn independent Evaluator session (NOT the Generator session)
      // This is the core Generator-Evaluator separation.
      // Per-task sessionKey lets multiple verifications run concurrently on the
      // same evaluator agent without aborting each other (spawnAgent cleanup
      // only affects the same sessionKey).
      const evaluatorId = `evaluator-${taskId}`;

      // Find reviewer agent — Generator-Evaluator separation requires a DIFFERENT agent
      // Always exclude the task's assignee (Generator) to prevent self-review
      let evaluatorAgent = db.prepare(
        "SELECT * FROM agents WHERE project_id = ? AND role = 'reviewer' AND id != ?",
      ).get(task.project_id, task.assignee_id) as any;

      if (!evaluatorAgent) {
        evaluatorAgent = db.prepare(
          "SELECT * FROM agents WHERE project_id = ? AND id != ? LIMIT 1",
        ).get(task.project_id, task.assignee_id) as any;
      }

      if (!evaluatorAgent) {
        // Last resort: reuse or create a system reviewer agent
        // INSERT OR IGNORE to prevent race condition when multiple tasks verify simultaneously
        db.prepare(
          "INSERT OR IGNORE INTO agents (project_id, name, role, system_prompt) VALUES (?, '[Nova] Evaluator', 'reviewer', ?)",
        ).run(task.project_id, "You are a code reviewer with an adversarial mindset. Find problems, don't pass them.");
        evaluatorAgent = db.prepare(
          "SELECT * FROM agents WHERE project_id = ? AND name = '[Nova] Evaluator' LIMIT 1",
        ).get(task.project_id) as any;
      }

      try {
        const evalWorkdir = config.workdir || project.workdir || (() => { throw new Error("Project has no workdir configured"); })();
        const session = sessionManager.spawnAgent(
          evaluatorAgent.id,
          evalWorkdir,
          evaluatorId,
        );

        // Surface the review activity on the evaluator agent so the UI can
        // show "누가 무엇을 검토 중인지". Without this, the evaluator agent
        // just turns "working" in the org chart with no task context.
        const reviewActivity = `review:${(task.title ?? "").slice(0, 80)}`;
        db.prepare(
          "UPDATE agents SET current_task_id = ?, current_activity = ? WHERE id = ?",
        ).run(taskId, reviewActivity, evaluatorAgent.id);
        broadcast("agent:status", {
          id: evaluatorAgent.id,
          name: evaluatorAgent.name,
          status: "working",
          taskId,
          activity: reviewActivity,
        });

        const runResult = await session.send(evaluationPrompt);
        const parsed = parseStreamJson(runResult.stdout);
        let result = parseVerificationResult(taskId, parsed.text, opts.scope, evaluatorId);

        // Retry once if parse failed (all dimensions score 0)
        const allZero = Object.values(result.dimensions).every((d) => d.value === 0);
        if (allZero && result.verdict === "fail") {
          log.info("Parse failed, retrying with explicit JSON reminder...");
          const retryPrompt = `이전 응답에서 JSON을 파싱하지 못했습니다. 반드시 \`\`\`json 블록으로만 응답하세요.\n\n${evaluationPrompt}`;
          const retryResult = await session.send(retryPrompt);
          const retryParsed = parseStreamJson(retryResult.stdout);
          result = parseVerificationResult(taskId, retryParsed.text, opts.scope, evaluatorId);

          // If still all zeros after retry — evaluator genuinely can't assess this task
          // (e.g., git merge/cleanup tasks with no code changes to review)
          // Treat as conditional pass rather than blocking the task
          const stillAllZero = Object.values(result.dimensions).every((d) => d.value === 0);
          if (stillAllZero && result.verdict === "fail") {
            log.warn(`Evaluator returned all-zero scores after retry for "${task.title}" — treating as conditional pass (likely non-code task)`);
            result.verdict = "conditional";
            result.severity = "auto-resolve";
            result.issues = [{
              id: "issue-parse-skip",
              severity: "info" as any,
              message: "Evaluator could not assess this task (no reviewable code changes). Auto-passed as conditional.",
            }];
          }
        }

        // Store result with RETURNING to avoid race-prone re-query
        const verRow = db.prepare(`
          INSERT INTO verifications (task_id, verdict, scope, dimensions, issues, severity, evaluator_session_id)
          VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
        `).get(
          taskId,
          result.verdict,
          result.scope,
          JSON.stringify(result.dimensions),
          JSON.stringify(result.issues),
          result.severity,
          evaluatorId,
        ) as { id: string };

        // Link verification to task
        db.prepare("UPDATE tasks SET verification_id = ?, updated_at = datetime('now') WHERE id = ?")
          .run(verRow.id, taskId);

        log.info(`Verification complete: ${result.verdict.toUpperCase()} [${result.severity}]`);
        return result;
      } catch (err) {
        log.error("Verification failed", err);
        throw err;
      } finally {
        // Cleanup evaluator session to prevent leak.
        // killSession resets the agent row to idle (when no sibling sessions
        // remain) — emit a status broadcast so the UI clears the review chip.
        sessionManager.killSession(evaluatorId);
        broadcast("agent:status", {
          id: evaluatorAgent.id,
          name: evaluatorAgent.name,
          status: "idle",
        });
      }
    },
  };
}

/**
 * Auto-detect verification scope based on task characteristics.
 * Aligns with Nova §1: high-risk areas auto-escalate one level.
 */
export function autoDetectScope(
  task: { title: string; description: string },
  changedFileCount?: number,
): VerificationScope {
  const text = `${task.title} ${task.description}`.toLowerCase();

  // Execution-verification tasks ALWAYS use full scope — they need Layer 3
  // to trigger the "you must actually run commands" rule.
  if (isExecutionVerificationTask(task.title, task.description)) return "full";

  // High-risk patterns always escalate (Nova §1: auth/DB/payment → one level up)
  const highRisk = [
    "auth", "login", "password", "token", "payment", "billing",
    "database", "migration", "schema", "security", "permission", "rbac",
    "encrypt", "decrypt", "secret", "credential",
  ];
  const isHighRisk = highRisk.some((p) => text.includes(p));

  const files = changedFileCount ?? 0;

  if (isHighRisk || files >= 8) return "full";
  if (files >= 3) return "standard";
  return "lite";
}

/**
 * Snapshot of what the Generator actually changed in the workdir. Extracted
 * from git so the Evaluator can compare against the task's stated scope and
 * catch "wrong directory" / "wrong stack" type errors that pure file reads
 * would miss.
 */
interface DiffSummary {
  /** `git diff --stat` output (file list + line counts), or null on error */
  stat: string | null;
  /** Short names of changed files (up to 30), for quick scope check */
  files: string[];
  /** Number of files changed (total, not truncated) */
  fileCount: number;
  /** Untracked files present in the workdir (up to 10) */
  untracked: string[];
  /** Base ref used (HEAD~1 when available, otherwise HEAD) */
  baseRef: string;
  /** Error message if git calls failed (workdir not a repo, etc.) */
  error?: string;
}

function collectDiffSummary(workdir: string | undefined): DiffSummary {
  const empty: DiffSummary = { stat: null, files: [], fileCount: 0, untracked: [], baseRef: "HEAD" };
  if (!workdir) return { ...empty, error: "No workdir provided" };

  const run = (args: string[]): { stdout: string; ok: boolean } => {
    try {
      const res = spawnSync("git", args, {
        cwd: workdir,
        stdio: "pipe",
        timeout: 5_000,
        encoding: "utf-8",
      });
      return { stdout: (res.stdout ?? "").trim(), ok: res.status === 0 };
    } catch {
      return { stdout: "", ok: false };
    }
  };

  // Detect if this is even a git repo
  const isRepo = run(["rev-parse", "--is-inside-work-tree"]);
  if (!isRepo.ok || isRepo.stdout !== "true") {
    return { ...empty, error: "Workdir is not a git repository" };
  }

  // Does HEAD~1 exist? (fresh repos / worktrees may only have 1 commit)
  const hasParent = run(["rev-parse", "--verify", "HEAD~1"]);
  const baseRef = hasParent.ok ? "HEAD~1" : "HEAD";

  // Unified stat — includes both staged + committed changes on the current branch
  const statCmd = hasParent.ok
    ? ["diff", "--stat", "HEAD~1..HEAD"]
    : ["show", "--stat", "HEAD"];
  const stat = run(statCmd);

  const namesCmd = hasParent.ok
    ? ["diff", "--name-only", "HEAD~1..HEAD"]
    : ["show", "--name-only", "--format=", "HEAD"];
  const names = run(namesCmd);
  const allFiles = names.stdout.split("\n").map((s) => s.trim()).filter(Boolean);

  const untracked = run(["ls-files", "--others", "--exclude-standard"]);
  const untrackedFiles = untracked.stdout.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10);

  return {
    stat: stat.ok ? stat.stdout.slice(0, 2000) : null, // hard cap to keep prompts small
    files: allFiles.slice(0, 30),
    fileCount: allFiles.length,
    untracked: untrackedFiles,
    baseRef,
  };
}

/**
 * Detect whether a task's stated purpose is "verify that something runs".
 * These tasks MUST NOT pass on file-reading alone — the Evaluator has to
 * actually execute build/dev commands and check process output.
 *
 * Pulsar regression: "프론트엔드 12개 페이지 렌더링 검증" and "전체 로컬
 * 실행 통합 검증 (QA)" were marked done without any shell execution. The
 * Evaluator (an LLM) hallucinated "렌더링 됨" without ever running code.
 */
/**
 * Substring patterns that trigger execution-verification mode regardless of
 * where in title/description they appear. The patterns are intentionally
 * conservative — better to miss a borderline task than to force expensive
 * Layer 3 execution on an unrelated task.
 */
const EXECUTION_VERIFY_PATTERNS: ReadonlyArray<RegExp> = [
  // Korean
  /렌더링 검증/,
  /기동 검증/,
  /실행 검증/,
  /로컬 실행/,
  /빌드 검증/,
  /통합 검증/,
  /통합 테스트/,
  /구동 확인/,
  /스모크 테스트/,
  // English
  /\brendering\b.*(check|verify|verification)/i,
  /\bbuild\b.*(check|verify|verification)/i,
  /\bstartup\b.*(check|verify)/i,
  /\bruntime\b.*(check|verify|test)/i,
  /\bintegration\b.*(test|verify)/i,
  /\bsmoke test\b/i,
  /\be2e\b/i,
  /\bend[-.\s]to[-.\s]end\b/i,
  /verify.*runs locally/i,
];

/**
 * Per-field patterns that only count when the field (usually the title)
 * terminates with the pattern. Prevents false positives like a description
 * casually mentioning "QA" mid-sentence.
 */
const EXECUTION_VERIFY_TERMINAL_PATTERNS: ReadonlyArray<RegExp> = [
  /QA\)?$/,  // ends with "QA" or "QA)" — the Pulsar "…통합 검증 (QA)" case
];

export function isExecutionVerificationTask(title: string, description: string): boolean {
  const combined = `${title ?? ""}\n${description ?? ""}`;
  if (EXECUTION_VERIFY_PATTERNS.some((p) => p.test(combined))) return true;

  // Terminal patterns: check trimmed title AND trimmed description
  // individually so "Final QA" matches (title ends with QA) but a long
  // description containing the word "QA" in the middle does not.
  const trimmedTitle = (title ?? "").trim();
  const trimmedDesc = (description ?? "").trim();
  for (const pattern of EXECUTION_VERIFY_TERMINAL_PATTERNS) {
    if (pattern.test(trimmedTitle)) return true;
    if (pattern.test(trimmedDesc)) return true;
  }
  return false;
}

function formatDiffSection(diff: DiffSummary): string {
  if (diff.error) {
    return `## Git Diff
_Not available: ${diff.error}_

You must verify by reading files directly. Ask: "Is the task's target
location actually modified? Did the agent touch the right directory?"`;
  }

  if (diff.fileCount === 0 && diff.untracked.length === 0) {
    return `## Git Diff
**WARNING: No files changed** compared to ${diff.baseRef}. If the task was
supposed to produce code changes, this is a red flag — return \`fail\` with
a clear "no changes produced" issue.`;
  }

  const fileList = diff.files.map((f) => `- ${f}`).join("\n");
  const moreFiles = diff.fileCount > diff.files.length
    ? `\n... and ${diff.fileCount - diff.files.length} more file(s)`
    : "";
  const untrackedSection = diff.untracked.length > 0
    ? `\n### Untracked (new, uncommitted) files\n${diff.untracked.map((f) => `- ${f}`).join("\n")}`
    : "";

  return `## Git Diff (vs ${diff.baseRef}) — ${diff.fileCount} file(s) changed

### Changed files
${fileList}${moreFiles}
${untrackedSection}

### Diff stat
\`\`\`
${diff.stat ?? "(stat unavailable)"}
\`\`\`

**SCOPE CHECK — this is a REQUIRED part of your verification:**
1. Do the changed paths match where the task said to implement it?
2. If the task mentions a specific framework or directory, are changes in
   the right place? (Example failure: task says "implement Next.js dashboard
   page" but changes are in \`dashboard/*.js\` vanilla JS instead of
   \`web/src/app/page.tsx\`.)
3. If files you'd expect to be modified are NOT in the list above, flag it
   as a \`fail\` with a "scope mismatch" issue.`;
}

function buildEvaluationPrompt(
  task: any,
  project: any,
  scope: VerificationScope,
  diff: DiffSummary,
): string {
  const novaRules = createNovaRulesEngine();
  const verificationProtocol = novaRules.getVerificationProtocol(scope);

  // Parse scope anchoring fields (P2). These are the explicit "where should
  // this code live" hints from task decomposition — if they exist, treat
  // mismatches as hard fails.
  const targetFiles: string[] = (() => {
    try {
      const parsed = JSON.parse(task.target_files ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((s: unknown) => typeof s === "string") : [];
    } catch {
      return [];
    }
  })();
  const stackHint = (task.stack_hint ?? "").trim();

  // P3: Execution verification enforcement — if the task title/description
  // says "렌더링 검증", "로컬 실행", "smoke test" etc., the Evaluator must
  // NOT pass on file-reading alone. It has to actually run commands.
  const needsExecution = isExecutionVerificationTask(task.title, task.description ?? "");
  const executionGate = needsExecution
    ? `\n## Execution Verification — MANDATORY for this task\n
This task is explicitly an execution-verification task. File-reading alone
is NOT sufficient. You MUST actually run commands in the workdir and report
concrete evidence. Do ALL of the following:

1. **Detect the runtime**: check \`package.json\`, \`pyproject.toml\`,
   \`Dockerfile\`, \`docker-compose.yml\`, \`Makefile\` for the canonical
   start/test commands.
2. **Attempt a build or type-check**: run the project's build or typecheck
   command (e.g., \`pnpm build\`, \`npm run type-check\`,
   \`python -m pytest\`, \`cargo check\`). Report the exit code and the
   last ~20 lines of output.
3. **Attempt runtime startup** (if the task is about running something):
   start the dev server in a background-safe way (e.g., with a 15-second
   timeout), then \`curl\` the expected URL. Report the HTTP status and the
   first 500 bytes of the response body.
4. **If you cannot execute** (sandbox forbids it, no command runner, etc.):
   DO NOT return \`pass\`. Return \`conditional\` and add a \`knownGaps\`
   entry naming exactly which command you needed to run but couldn't.

**Hallucinating success is the worst possible outcome here.** The previous
Pulsar regression happened precisely because evaluators wrote "렌더링 정상"
without ever touching a shell. Do not repeat that.

When you DO run commands, include the command and a short transcript in
your issues[] notes so the reviewer can audit the verification trail.\n`
    : "";

  let scopeAnchorSection = "";
  if (targetFiles.length > 0 || stackHint) {
    const targetBlock = targetFiles.length > 0
      ? `**Expected target files** (the task says these should be modified):
${targetFiles.map((f) => `- \`${f}\``).join("\n")}

**REQUIRED CHECK**: cross-reference this list with the Git Diff above. If
ANY expected file is missing from the diff, OR if the diff contains files in
a completely different tree (e.g., expected \`web/src/app/page.tsx\` but
diff shows \`dashboard/app.js\`), return \`fail\` with a clear
"scope mismatch" issue message.`
      : "";
    const stackBlock = stackHint
      ? `**Stack constraint**: ${stackHint}

If the changed files don't match this stack (e.g., task says Next.js but
changes are vanilla HTML/CSS/JS), return \`fail\`.`
      : "";

    scopeAnchorSection = `\n## Scope Anchor — strict check\n${targetBlock}\n\n${stackBlock}\n`;
  }

  return `# Code Review — Quality Verification (Nova Protocol)

Review the code changes for task: "${task.title}"
${task.description ? `\nTask description: ${task.description}` : ""}

${formatDiffSection(diff)}
${scopeAnchorSection}${executionGate}

## Verification Scope: ${scope.toUpperCase()}

${verificationProtocol || `Scope: ${scope} — Evaluate code quality, correctness, and safety.`}

## Evaluator Stance
"통과시키지 마라. 문제를 찾아라." — Do not rubber-stamp. Find problems.
Code existing is not the same as code working.

## Score each dimension 0-10:

1. **Functionality** — Does it do what the task asked for?
2. **Data Flow** — Input → Save → Load → Display complete?
3. **Design Alignment** — Does it follow existing codebase patterns?
4. **Craft** — Error handling, type safety, edge cases?
5. **Edge Cases** — Boundary values (0, negative, empty, max) safe?

## Verdict Rules:
- **PASS**: All layers for this scope completed, no critical/high issues, AND scope check passed
- **CONDITIONAL**: Code looks correct but Layer 3 (execution) could not be verified → MUST list Known Gaps
- **FAIL**: ANY of the following →
  - Critical or high severity issue found
  - Functionality broken or security/data-loss risk
  - **Scope mismatch — the agent changed the wrong files or created code in the wrong directory/stack**
  - **No files changed when the task required code changes** (check the diff section above)

${scope === "full" ? `
## CRITICAL: Layer 3 Execution Rule
If you CANNOT execute Layer 3 (no DB, no runtime, no test runner):
- Do NOT return "pass"
- Return "conditional" with Known Gaps listing what needs manual verification
- Example issue: "Layer 3 미수행 — API 서버 기동 후 curl 테스트 필요"
` : ""}

## Output — respond ONLY with this JSON block:

\`\`\`json
{
  "verdict": "pass",
  "severity": "auto-resolve",
  "dimensions": {
    "functionality": { "value": 8, "notes": "..." },
    "dataFlow": { "value": 7, "notes": "..." },
    "designAlignment": { "value": 8, "notes": "..." },
    "craft": { "value": 7, "notes": "..." },
    "edgeCases": { "value": 6, "notes": "..." }
  },
  "issues": [
    {
      "severity": "critical",
      "file": "path/to/file.py",
      "line": 42,
      "message": "Concrete description of the problem — what is wrong and why it breaks. REQUIRED. Never omit or leave blank. The auto-fix agent reads this verbatim.",
      "suggestion": "Concrete fix guidance — what code change resolves it. REQUIRED for critical/hard-block."
    }
  ],
  "knownGaps": []
}
\`\`\`

- \`verdict\`: "pass" | "conditional" | "fail"
- \`severity\`: "auto-resolve" (minor), "soft-block" (runtime risk), "hard-block" (security/data loss)
- \`issues\`: only list actual problems found, empty array if none.
  **CRITICAL: every issue MUST have a non-empty \`message\` field.** An issue
  without a message is useless — the auto-fix loop cannot act on it and the
  task will get stuck retrying. If you cannot describe the problem concretely,
  do not file the issue.
- \`knownGaps\`: areas that could not be verified (Layer 3 not executed, etc.)
`;
}

function parseVerificationResult(
  taskId: string,
  rawOutput: string,
  scope: VerificationScope,
  evaluatorSessionId: string,
): VerificationResult {
  const defaultScore: Score = { value: 0, notes: "Evaluation failed — could not parse result" };
  const parseErrorIssue: VerificationIssue = {
    id: "issue-parse-error",
    severity: "high",
    message: "Evaluation parse error — the evaluator did not return valid JSON",
    suggestion: "Re-run verification to get a proper evaluation result",
  };
  const defaultResult: VerificationResult = {
    id: "",
    taskId,
    verdict: "fail" as Verdict,
    scope,
    dimensions: {
      functionality: defaultScore,
      dataFlow: defaultScore,
      designAlignment: defaultScore,
      craft: defaultScore,
      edgeCases: defaultScore,
    },
    issues: [parseErrorIssue],
    severity: "soft-block" as Severity,
    evaluatorSessionId,
    createdAt: new Date().toISOString(),
  };

  try {
    // Extract JSON from the output
    const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)\s*```/) ??
                      rawOutput.match(/\{[\s\S]*"verdict"[\s\S]*\}/);

    if (!jsonMatch) {
      log.warn("Could not parse verification JSON, returning fail");
      return defaultResult;
    }

    const jsonStr = jsonMatch[1] ?? jsonMatch[0];
    const parsed = JSON.parse(jsonStr);

    const dimensions = {
      functionality: parsed.dimensions?.functionality ?? defaultScore,
      dataFlow: parsed.dimensions?.dataFlow ?? defaultScore,
      designAlignment: parsed.dimensions?.designAlignment ?? defaultScore,
      craft: parsed.dimensions?.craft ?? defaultScore,
      edgeCases: parsed.dimensions?.edgeCases ?? defaultScore,
    };

    // Trust the evaluator agent's verdict — do NOT override based on score averages.
    // The evaluator may FAIL a task with high dimension scores if it found a critical
    // issue (e.g., security vulnerability) that doesn't map neatly to any dimension.
    // Overriding FAIL→PASS based on avg score was a Critical bug (Nova gap analysis).
    const VALID_VERDICTS = new Set(["pass", "conditional", "fail"]);
    const rawVerdict = String(parsed.verdict ?? "fail").toLowerCase().trim();
    let verdict: Verdict = VALID_VERDICTS.has(rawVerdict) ? (rawVerdict as Verdict) : "fail";

    // Resolve message across known field name variants. Different evaluator
    // runs have returned the payload under `message`, `description`, `detail`,
    // `text`, `issue`, or `title` — accept any of them so the auto-fix loop
    // receives a concrete problem statement instead of "No description".
    const pickMessage = (issue: any): string => {
      const candidates = [
        issue.message,
        issue.description,
        issue.detail,
        issue.text,
        issue.issue,
        issue.title,
        issue.reason,
        issue.problem,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim()) return c;
      }
      return "No description";
    };

    const issues = (parsed.issues ?? []).map((issue: any, i: number) => ({
      id: `issue-${i}`,
      severity: issue.severity ?? "warning",
      file: issue.file,
      line: issue.line,
      message: pickMessage(issue),
      suggestion: issue.suggestion ?? issue.fix ?? issue.recommendation,
    }));

    // Also correct severity based on actual issues
    const hasCritical = issues.some((i: any) => i.severity === "critical");
    const severity: Severity = hasCritical ? "hard-block" : (parsed.severity ?? "auto-resolve");

    return {
      ...defaultResult,
      verdict,
      severity,
      dimensions,
      issues,
    };
  } catch (err) {
    log.warn("Failed to parse verification result", err);
    return defaultResult;
  }
}
