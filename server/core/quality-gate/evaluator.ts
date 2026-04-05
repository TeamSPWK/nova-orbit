import type { Database } from "better-sqlite3";
import type { SessionManager } from "../agent/session.js";
import { parseStreamJson } from "../agent/adapters/stream-parser.js";
import { createLogger } from "../../utils/logger.js";
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
      config: Partial<QualityGateConfig> = {},
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
      // This is the core Generator-Evaluator separation
      const evaluatorId = `evaluator-${taskId}`;

      // Find reviewer agent — Generator-Evaluator separation requires a DIFFERENT agent
      let evaluatorAgent = db.prepare(
        "SELECT * FROM agents WHERE project_id = ? AND role = 'reviewer'",
      ).get(task.project_id) as any;

      if (!evaluatorAgent) {
        // Find any agent that is NOT the task's assignee (Generator)
        evaluatorAgent = db.prepare(
          "SELECT * FROM agents WHERE project_id = ? AND id != ? LIMIT 1",
        ).get(task.project_id, task.assignee_id) as any;
      }

      if (!evaluatorAgent) {
        // Last resort: reuse or create a system reviewer agent (name prefixed to distinguish from user-created)
        evaluatorAgent = db.prepare(
          "SELECT * FROM agents WHERE project_id = ? AND name = '[Nova] Evaluator' LIMIT 1",
        ).get(task.project_id) as any;

        if (!evaluatorAgent) {
          log.info("No separate evaluator agent found, creating system reviewer");
          db.prepare(
            "INSERT INTO agents (project_id, name, role, system_prompt) VALUES (?, '[Nova] Evaluator', 'reviewer', ?)",
          ).run(task.project_id, "You are a code reviewer with an adversarial mindset. Find problems, don't pass them.");
          evaluatorAgent = db.prepare(
            "SELECT * FROM agents WHERE project_id = ? AND name = '[Nova] Evaluator' LIMIT 1",
          ).get(task.project_id) as any;
        }
      }

      try {
        const session = sessionManager.spawnAgent(
          evaluatorAgent.id,
          project.workdir || process.cwd(),
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
        }

        // Store result
        db.prepare(`
          INSERT INTO verifications (task_id, verdict, scope, dimensions, issues, severity, evaluator_session_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          taskId,
          result.verdict,
          result.scope,
          JSON.stringify(result.dimensions),
          JSON.stringify(result.issues),
          result.severity,
          evaluatorId,
        );

        // Update task status based on verdict
        if (result.verdict === "pass") {
          db.prepare("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?").run(taskId);
        } else if (result.severity === "hard-block") {
          db.prepare("UPDATE tasks SET status = 'blocked', updated_at = datetime('now') WHERE id = ?").run(taskId);
        }

        log.info(`Verification complete: ${result.verdict.toUpperCase()} [${result.severity}]`);
        return result;
      } catch (err) {
        log.error("Verification failed", err);
        throw err;
      }
    },
  };
}

function buildEvaluationPrompt(task: any, project: any, scope: VerificationScope): string {
  const scopeInstructions: Record<VerificationScope, string> = {
    lite: `Layer 1 only: Static analysis — lint/type-check, unused imports, security patterns.`,
    standard: `Layer 1 + 2: Static analysis AND semantic analysis — design-implementation consistency, business logic correctness.`,
    full: `Layer 1 + 2 + 3: Static + semantic + execution-based validation — run tests, verify API endpoints, check edge cases.`,
  };

  return `# Nova Quality Gate — Adversarial Evaluation

You are an independent Evaluator. You have NO context from the implementation agent.
Review the code changes for task: "${task.title}"
${task.description ? `\nTask description: ${task.description}` : ""}

## Verification Scope: ${scope.toUpperCase()}
${scopeInstructions[scope]}

## 5-Dimension Verification Framework

Score each dimension 0-10 with notes:

1. **Functionality** — Does the implementation match the task requirements?
2. **Data Flow** — Is the data pipeline complete (input → process → store → display)?
3. **Design Alignment** — Does it follow existing codebase conventions and architecture?
4. **Craft** — Error handling, type safety, logging, code clarity?
5. **Edge Cases** — Boundary values (0, -1, empty string, null, max int) handled?

## Output Format

CRITICAL: Your response MUST contain a valid JSON block wrapped in \`\`\`json ... \`\`\`.
Do NOT include any text outside the JSON block.
If you cannot evaluate a dimension, score it 0 and explain why in the notes field.

\`\`\`json
{
  "verdict": "pass",
  "severity": "auto-resolve",
  "dimensions": {
    "functionality": { "value": 8, "notes": "Implementation matches requirements" },
    "dataFlow": { "value": 7, "notes": "Data pipeline is complete" },
    "designAlignment": { "value": 9, "notes": "Follows existing patterns" },
    "craft": { "value": 8, "notes": "Good error handling" },
    "edgeCases": { "value": 6, "notes": "Most edge cases handled" }
  },
  "issues": []
}
\`\`\`

Replace the example values above with your actual evaluation. Use this exact structure.

Rules:
- "Don't pass it — find the problem"
- Any data loss / security / irreversible issue = hard-block
- Failing tests or broken build = fail
- If you cannot execute Layer 3 verification, issue "conditional" (not "pass")
- verdict must be exactly one of: "pass", "conditional", "fail"
- severity must be exactly one of: "auto-resolve", "soft-block", "hard-block"
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

    return {
      ...defaultResult,
      verdict: parsed.verdict ?? "fail",
      severity: parsed.severity ?? "soft-block",
      dimensions: {
        functionality: parsed.dimensions?.functionality ?? defaultScore,
        dataFlow: parsed.dimensions?.dataFlow ?? defaultScore,
        designAlignment: parsed.dimensions?.designAlignment ?? defaultScore,
        craft: parsed.dimensions?.craft ?? defaultScore,
        edgeCases: parsed.dimensions?.edgeCases ?? defaultScore,
      },
      issues: (parsed.issues ?? []).map((issue: any, i: number) => ({
        id: `issue-${i}`,
        severity: issue.severity ?? "warning",
        file: issue.file,
        line: issue.line,
        message: issue.message ?? "No description",
        suggestion: issue.suggestion,
      })),
    };
  } catch (err) {
    log.warn("Failed to parse verification result", err);
    return defaultResult;
  }
}
