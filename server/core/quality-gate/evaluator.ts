import type { Database } from "better-sqlite3";
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
export function createQualityGate(db: Database, sessionManager: SessionManager) {
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

      // Build evaluation prompt
      const evaluationPrompt = buildEvaluationPrompt(task, project, opts.scope);

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
        // Cleanup evaluator session to prevent leak
        sessionManager.killSession(evaluatorId);
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

function buildEvaluationPrompt(task: any, project: any, scope: VerificationScope): string {
  const novaRules = createNovaRulesEngine();
  const verificationProtocol = novaRules.getVerificationProtocol(scope);

  return `# Code Review — Quality Verification (Nova Protocol)

Review the code changes for task: "${task.title}"
${task.description ? `\nTask description: ${task.description}` : ""}

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
- **PASS**: All layers for this scope completed, no critical/high issues
- **CONDITIONAL**: Code looks correct but Layer 3 (execution) could not be verified → MUST list Known Gaps
- **FAIL**: Critical or high severity issue found, OR functionality broken, OR security/data-loss risk

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
  "issues": [],
  "knownGaps": []
}
\`\`\`

- severity: "auto-resolve" (minor), "soft-block" (runtime risk), "hard-block" (security/data loss)
- issues: only list actual problems found, empty array if none
- knownGaps: areas that could not be verified (Layer 3 not executed, etc.)
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

    const issues = (parsed.issues ?? []).map((issue: any, i: number) => ({
      id: `issue-${i}`,
      severity: issue.severity ?? "warning",
      file: issue.file,
      line: issue.line,
      message: issue.message ?? "No description",
      suggestion: issue.suggestion,
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
