import type { Database } from "better-sqlite3";
import type { SessionManager } from "../agent/session.js";
import { parseStreamJson } from "../agent/adapters/stream-parser.js";
import { createQualityGate } from "../quality-gate/evaluator.js";
import { createLogger } from "../../utils/logger.js";
import type { VerificationScope } from "../../../shared/types.js";

const log = createLogger("orchestration");

export interface OrchestrationConfig {
  verificationScope: VerificationScope;
  autoFix: boolean;
  maxFixRetries: number;
}

const DEFAULT_CONFIG: OrchestrationConfig = {
  verificationScope: "standard",
  autoFix: true,
  maxFixRetries: 1,
};

/**
 * Orchestration Engine — Goal → Task decomposition → Agent execution → Verification
 *
 * Pipeline (ported from Nova Orchestrator):
 * 1. Receive goal/task
 * 2. Assign to appropriate agent (Coder)
 * 3. Agent executes via Claude Code session
 * 4. Quality Gate verification (independent Evaluator)
 * 5. If FAIL + autoFix: spawn fix agent → re-verify (max 1 retry)
 * 6. Report results
 */
export function createOrchestrationEngine(
  db: Database,
  sessionManager: SessionManager,
  broadcast: (event: string, data: unknown) => void,
) {
  const qualityGate = createQualityGate(db, sessionManager);

  return {
    /**
     * Execute a single task: assign → run → verify → (optional fix)
     */
    async executeTask(
      taskId: string,
      config: Partial<OrchestrationConfig> = {},
    ): Promise<{ success: boolean; verdict: string }> {
      const opts = { ...DEFAULT_CONFIG, ...config };
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
      if (!task) throw new Error(`Task ${taskId} not found`);

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(task.project_id) as any;
      if (!project) throw new Error(`Project not found`);

      log.info(`Executing task: "${task.title}"`);

      // Phase 1: Set task to in_progress
      db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?")
        .run(taskId);
      broadcast("task:updated", { ...task, status: "in_progress" });

      // Phase 2: Execute via assigned agent
      if (!task.assignee_id) {
        throw new Error("Task has no assigned agent");
      }

      // Validate workdir exists
      const workdir = project.workdir || process.cwd();
      const { existsSync } = await import("node:fs");
      if (!existsSync(workdir)) {
        throw new Error(`Working directory does not exist: ${workdir}`);
      }

      let session;
      try {
        session = sessionManager.spawnAgent(task.assignee_id, workdir);
      } catch (spawnErr: any) {
        log.error(`Failed to spawn agent for task "${task.title}"`, spawnErr);
        throw new Error(`Agent spawn failed: ${spawnErr.message}`);
      }

      // Stream agent output to WebSocket for real-time dashboard display
      session.on("output", (text: string) => {
        broadcast("agent:output", { agentId: task.assignee_id, output: text, taskId });
      });

      // Update agent status
      db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?")
        .run(taskId, task.assignee_id);
      broadcast("agent:status", { id: task.assignee_id, status: "working", taskId });
      broadcast("task:started", { taskId, agentId: task.assignee_id, startedAt: new Date().toISOString() });

      try {
        const implementationPrompt = `
# Task: ${task.title}

${task.description}

Implement this task. Focus on:
- Clean, production-ready code
- Follow existing codebase conventions
- Run lint/type-check before finishing
- DO NOT verify your own work — verification is handled separately

When complete, provide a summary of changes made.
`;

        const implResult = await session.send(implementationPrompt);
        const implParsed = parseStreamJson(implResult.stdout);
        log.info(`Implementation complete for task "${task.title}"`, {
          cost: implParsed.usage?.totalCostUsd,
          tokens: implParsed.usage ? implParsed.usage.inputTokens + implParsed.usage.outputTokens + implParsed.usage.cacheCreationTokens : 0,
          duration: implParsed.usage?.durationMs,
        });

        // Broadcast usage data for dashboard
        if (implParsed.usage) {
          broadcast("task:usage", {
            taskId,
            agentId: task.assignee_id,
            usage: implParsed.usage,
          });

          // Update session token usage in DB
          db.prepare(
            "UPDATE sessions SET token_usage = token_usage + ? WHERE agent_id = ? AND status = 'active'",
          ).run(
            implParsed.usage.inputTokens + implParsed.usage.outputTokens + implParsed.usage.cacheCreationTokens,
            task.assignee_id,
          );
        }

        // Broadcast completion
        broadcast("task:completed", {
          taskId,
          agentId: task.assignee_id,
          completedAt: new Date().toISOString(),
        });

        // Log activity
        db.prepare(`
          INSERT INTO activities (project_id, agent_id, type, message)
          VALUES (?, ?, 'task_completed', ?)
        `).run(task.project_id, task.assignee_id, `Completed: ${task.title}`);

        // Phase 3: Move to review
        db.prepare("UPDATE tasks SET status = 'in_review', updated_at = datetime('now') WHERE id = ?")
          .run(taskId);
        broadcast("task:updated", { ...task, status: "in_review" });

        // Phase 4: Quality Gate verification
        const verification = await qualityGate.verify(taskId, {
          scope: opts.verificationScope,
        });

        broadcast("verification:result", verification);

        // Phase 5: Auto-fix if needed
        if (verification.verdict === "fail" && opts.autoFix && opts.maxFixRetries > 0) {
          log.info("Verification FAIL — attempting auto-fix");

          const fixPrompt = `
# Fix Required

The following issues were found during verification:
${verification.issues.map((i) => `- [${i.severity}] ${i.file ?? ""}:${i.line ?? ""} — ${i.message}`).join("\n")}

Fix ONLY these issues. Do not modify other code.
`;
          // Spawn a NEW session for fix (prevent context pollution — Nova rule)
          const fixSession = sessionManager.spawnAgent(task.assignee_id, project.workdir || process.cwd());
          await fixSession.send(fixPrompt);

          // Re-verify
          const reVerification = await qualityGate.verify(taskId, {
            scope: opts.verificationScope,
          });
          broadcast("verification:result", reVerification);

          return {
            success: reVerification.verdict === "pass",
            verdict: reVerification.verdict,
          };
        }

        return {
          success: verification.verdict === "pass",
          verdict: verification.verdict,
        };
      } catch (err) {
        log.error(`Task execution failed: ${task.title}`, err);
        db.prepare("UPDATE tasks SET status = 'blocked', updated_at = datetime('now') WHERE id = ?")
          .run(taskId);
        broadcast("task:updated", { ...task, status: "blocked" });
        throw err;
      } finally {
        // Reset agent status
        db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?")
          .run(task.assignee_id);
        broadcast("agent:status", { id: task.assignee_id, status: "idle" });
      }
    },

    /**
     * Decompose a goal into tasks using AI.
     * Uses a meta-agent to analyze the goal and create structured tasks.
     */
    async decomposeGoal(goalId: string): Promise<void> {
      const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as any;
      if (!goal) throw new Error(`Goal ${goalId} not found`);

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(goal.project_id) as any;

      log.info(`Decomposing goal: "${goal.description}"`);

      // Find or create a coder agent for decomposition
      const agent = db.prepare(
        "SELECT * FROM agents WHERE project_id = ? LIMIT 1",
      ).get(goal.project_id) as any;

      if (!agent) {
        throw new Error("No agents available for task decomposition");
      }

      const session = sessionManager.spawnAgent(agent.id, project?.workdir || process.cwd());

      const decomposePrompt = `
# Goal Decomposition

Break down this goal into concrete, actionable tasks:
"${goal.description}"

Rules:
- Each task should be completable by a single agent
- Tasks should be ordered by dependency
- Include clear acceptance criteria in each task description
- Keep tasks small and focused (1-4 hours each)

Respond in this EXACT JSON format:
\`\`\`json
{
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed description with acceptance criteria",
      "role": "coder" | "reviewer"
    }
  ]
}
\`\`\`
`;

      const runResult = await session.send(decomposePrompt);
      const parsed = parseStreamJson(runResult.stdout);

      // Parse tasks from AI response
      try {
        const jsonMatch = parsed.text.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch) throw new Error("No JSON found in decomposition response");

        const decomposed = JSON.parse(jsonMatch[1]);
        const tasks = decomposed.tasks ?? [];

        // Auto-assign agents by role
        const projectAgents = db.prepare(
          "SELECT * FROM agents WHERE project_id = ?",
        ).all(goal.project_id) as any[];

        const findAgent = (role: string) =>
          projectAgents.find((a) => a.role === role) ??
          projectAgents.find((a) => a.role === "coder") ??
          projectAgents[0] ?? null;

        for (const t of tasks) {
          const agent = findAgent(t.role ?? "coder");
          db.prepare(`
            INSERT INTO tasks (goal_id, project_id, title, description, assignee_id)
            VALUES (?, ?, ?, ?, ?)
          `).run(goal.id, goal.project_id, t.title, t.description ?? "", agent?.id ?? null);
        }

        log.info(`Created ${tasks.length} tasks from goal decomposition`);
        broadcast("project:updated", { projectId: goal.project_id });
      } catch (err) {
        log.error("Failed to parse task decomposition", err);
        throw err;
      }
    },
  };
}
