import type { Database } from "better-sqlite3";
import type { SessionManager } from "../agent/session.js";
import { parseStreamJson } from "../agent/adapters/stream-parser.js";
import { createQualityGate } from "../quality-gate/evaluator.js";
import { createDelegationEngine } from "./delegation.js";
import { createLogger } from "../../utils/logger.js";
import type { VerificationScope } from "../../../shared/types.js";

const log = createLogger("orchestration");

// DB row types (snake_case as stored in SQLite)
interface TaskRow {
  id: string;
  goal_id: string;
  project_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  parent_task_id: string | null;
  status: string;
  verification_id: string | null;
}
interface ProjectRow {
  id: string;
  name: string;
  mission: string;
  workdir: string;
  autopilot: string; // 'off' | 'goal' | 'full'
}
interface GoalRow {
  id: string;
  project_id: string;
  description: string;
}
interface AgentRow {
  id: string;
  role: string;
  parent_id: string | null;
}

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
  const delegationEngine = createDelegationEngine(db, sessionManager, broadcast);

  return {
    /**
     * Execute a single task: assign → run → verify → (optional fix)
     */
    async executeTask(
      taskId: string,
      config: Partial<OrchestrationConfig> = {},
    ): Promise<{ success: boolean; verdict: string }> {
      const opts = { ...DEFAULT_CONFIG, ...config };
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
      if (!task) throw new Error(`Task ${taskId} not found`);

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(task.project_id) as ProjectRow | undefined;
      if (!project) throw new Error(`Project not found`);

      log.info(`Executing task: "${task.title}"`);

      // Pre-check: assignee must exist before any state changes
      if (!task.assignee_id) {
        throw new Error("Task has no assigned agent");
      }

      const agent = db.prepare("SELECT name FROM agents WHERE id = ?").get(task.assignee_id) as { name: string } | undefined;
      const agentName = agent?.name ?? "";
      const workdir = project.workdir || process.cwd();
      const { existsSync } = await import("node:fs");
      if (!existsSync(workdir)) {
        throw new Error(`Working directory does not exist: ${workdir}`);
      }

      // Phase 0: Attempt delegation to subordinates (only for root tasks)
      if (!task.parent_task_id) {
        try {
          const delegation = await delegationEngine.attemptDelegation(taskId);
          if (delegation.delegated) {
            log.info(`Task "${task.title}" delegated to ${delegation.subtaskIds.length} subtasks`);
            return { success: true, verdict: "delegated" };
          }
        } catch (delegationErr: any) {
          log.warn(`Delegation attempt failed, falling back to direct execution: ${delegationErr.message}`);
        }
      }

      // Phase 1: Set task to in_progress
      transitionTask(db, broadcast, task, "in_progress");

      // Phase 2: Execute via assigned agent
      let session;
      try {
        session = sessionManager.spawnAgent(task.assignee_id, workdir);
      } catch (spawnErr: any) {
        log.error(`Failed to spawn agent for task "${task.title}"`, spawnErr);
        throw new Error(`Agent spawn failed: ${spawnErr.message}`);
      }

      // Stream agent output to WebSocket
      session.on("output", (text: string) => {
        broadcast("agent:output", { agentId: task.assignee_id, output: text, taskId });
      });

      session.on("rate-limit", (info: { waitMs: number; stderr: string }) => {
        broadcast("system:rate-limit", {
          agentId: task.assignee_id,
          agentName,
          taskId,
          waitMs: info.waitMs,
          message: info.stderr,
        });
      });
      db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?")
        .run(taskId, task.assignee_id);
      broadcast("agent:status", { id: task.assignee_id, name: agentName, status: "working", taskId });
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

        // Subtasks skip verification (design decision: parent task level QG only)
        if (task.parent_task_id) {
          transitionTask(db, broadcast, task, "done");
          return { success: true, verdict: "pass" };
        }

        // Phase 3: Move to review
        transitionTask(db, broadcast, task, "in_review");

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
          try {
            await fixSession.send(fixPrompt);
          } finally {
            sessionManager.killSession(task.assignee_id);
          }

          // Re-verify
          const reVerification = await qualityGate.verify(taskId, {
            scope: opts.verificationScope,
          });
          broadcast("verification:result", reVerification);

          // Update task status based on re-verification result
          const rePass = reVerification.verdict === "pass" || reVerification.verdict === "conditional";
          transitionTask(db, broadcast, task, rePass ? "done" : "blocked");

          return {
            success: reVerification.verdict === "pass",
            verdict: reVerification.verdict,
          };
        }

        // Update task status based on verification result
        // pass + conditional → done, fail → blocked
        const passed = verification.verdict === "pass" || verification.verdict === "conditional";
        transitionTask(db, broadcast, task, passed ? "done" : "blocked");

        return {
          success: verification.verdict === "pass",
          verdict: verification.verdict,
        };
      } catch (err: any) {
        log.error(`Task execution failed: ${task.title}`, err);
        // Rate limit errors → back to todo for retry, not blocked
        const isRateLimit = err.message?.toLowerCase().includes("rate limit") ||
          err.message?.toLowerCase().includes("429") ||
          err.message?.toLowerCase().includes("too many requests");
        const fallbackStatus = isRateLimit ? "todo" : "blocked";
        transitionTask(db, broadcast, task, fallbackStatus);
        if (isRateLimit) {
          log.warn(`Task "${task.title}" returned to todo due to rate limit — will retry on next queue poll`);
        }
        throw err;
      } finally {
        // Reset agent status
        db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?")
          .run(task.assignee_id);
        broadcast("agent:status", { id: task.assignee_id, name: agentName, status: "idle" });
      }
    },

    /**
     * Decompose a goal into tasks using AI.
     * Returns the number of tasks created (used by autopilot to trigger queue).
     */
    async decomposeGoal(goalId: string): Promise<{ taskCount: number; projectId: string }> {
      const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as GoalRow | undefined;
      if (!goal) throw new Error(`Goal ${goalId} not found`);

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(goal.project_id) as ProjectRow | undefined;

      log.info(`Decomposing goal: "${goal.description}"`);

      // Prefer CTO/lead agent for decomposition; fall back to any agent
      const agent = db.prepare(
        "SELECT * FROM agents WHERE project_id = ? AND role = 'cto' LIMIT 1",
      ).get(goal.project_id) as AgentRow | undefined
        ?? db.prepare(
          "SELECT * FROM agents WHERE project_id = ? LIMIT 1",
        ).get(goal.project_id) as AgentRow | undefined;

      if (!agent) {
        throw new Error("No agents available for task decomposition");
      }

      let session;
      try {
        session = sessionManager.spawnAgent(agent.id, project?.workdir || process.cwd());
      } catch (err: any) {
        throw new Error(`Failed to spawn agent for decomposition: ${err.message}`);
      }

      // Gather available roles for the prompt
      const availableAgents = db.prepare(
        "SELECT name, role FROM agents WHERE project_id = ? AND role != 'cto'",
      ).all(goal.project_id) as { name: string; role: string }[];
      const roleList = availableAgents.map((a) => `"${a.role}" (${a.name})`).join(", ");

      const decomposePrompt = `
# Goal Decomposition

Break down this goal into concrete, actionable tasks:
"${goal.description}"

Available team members: ${roleList || "coder"}

Rules:
- Each task should be completable by a single agent
- Tasks should be ordered by dependency
- Include clear acceptance criteria in each task description
- Keep tasks small and focused (1-4 hours each)
- Use the "role" field to assign tasks to available team members

Respond in this EXACT JSON format:
\`\`\`json
{
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed description with acceptance criteria",
      "role": "${availableAgents[0]?.role ?? "coder"}"
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

        // Safety: cap task count to prevent runaway decomposition
        const MAX_TASKS_PER_GOAL = 10;
        const safeTasks = tasks.slice(0, MAX_TASKS_PER_GOAL);

        // Auto-assign agents by role — prefer CTO's children, fallback to all non-CTO
        const projectAgents = db.prepare(
          "SELECT * FROM agents WHERE project_id = ?",
        ).all(goal.project_id) as AgentRow[];

        const ctoAgent = projectAgents.find((a) => a.role === "cto");
        const ctoChildren = ctoAgent
          ? projectAgents.filter((a) => a.parent_id === ctoAgent.id)
          : [];
        // If CTO has no children, use all non-CTO agents as candidates
        const nonCto = projectAgents.filter((a) => a.role !== "cto");
        const candidates = ctoChildren.length > 0 ? ctoChildren : nonCto;

        // Flexible role matching: exact → partial keyword → any coder → first available
        const findAgent = (role: string) => {
          const r = role.toLowerCase();
          return candidates.find((a) => a.role === r) ??
            candidates.find((a) => r.includes(a.role) || a.role.includes(r)) ??
            candidates.find((a) => a.role === "coder" || a.role === "frontend" || a.role === "backend") ??
            candidates[0] ?? projectAgents.find((a) => a.role !== "cto") ?? projectAgents[0] ?? null;
        };

        const MAX_TITLE_LEN = 200;
        const MAX_DESC_LEN = 2000;
        let created = 0;

        for (const t of safeTasks) {
          if (!t.title || typeof t.title !== "string") continue;
          const title = t.title.slice(0, MAX_TITLE_LEN);
          const description = typeof t.description === "string" ? t.description.slice(0, MAX_DESC_LEN) : "";
          const agent = findAgent(t.role ?? "coder");
          db.prepare(`
            INSERT INTO tasks (goal_id, project_id, title, description, assignee_id)
            VALUES (?, ?, ?, ?, ?)
          `).run(goal.id, goal.project_id, title, description, agent?.id ?? null);
          created++;
        }

        log.info(`Created ${created} tasks from goal decomposition`);
        broadcast("project:updated", { projectId: goal.project_id });
        return { taskCount: created, projectId: goal.project_id };
      } catch (err) {
        log.error("Failed to parse task decomposition", err);
        throw err;
      } finally {
        // Cleanup decompose session to free the agent
        sessionManager.killSession(agent.id);
      }
    },

    /**
     * Full Autopilot: CTO generates goals from project mission.
     * Safety: max 5 goals per invocation, auto-downgrades to 'goal' mode after completion.
     */
    async generateGoalsFromMission(projectId: string): Promise<{ goalIds: string[] }> {
      const MAX_AUTO_GOALS = 5;

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
      if (!project) throw new Error(`Project ${projectId} not found`);

      if (!project.mission || project.mission.trim() === "") {
        throw new Error("Project has no mission set — cannot generate goals in Full mode");
      }

      // Safety: check if there are already pending/in_progress goals
      const activeGoals = db.prepare(
        "SELECT COUNT(*) as count FROM goals WHERE project_id = ? AND progress < 100",
      ).get(projectId) as { count: number };

      if (activeGoals.count >= MAX_AUTO_GOALS) {
        log.warn(`Full autopilot: project already has ${activeGoals.count} active goals, skipping generation`);
        return { goalIds: [] };
      }

      const remainingSlots = MAX_AUTO_GOALS - activeGoals.count;

      const ctoAgent = db.prepare(
        "SELECT * FROM agents WHERE project_id = ? AND role = 'cto' LIMIT 1",
      ).get(projectId) as AgentRow | undefined;

      if (!ctoAgent) {
        throw new Error("Full autopilot requires a CTO agent");
      }

      log.info(`Full autopilot: generating goals from mission "${project.mission.slice(0, 50)}..."`);

      const session = sessionManager.spawnAgent(ctoAgent.id, project.workdir || process.cwd());

      const prompt = `
# Mission Analysis — Goal Generation

You are the CTO. Analyze this project's mission and create actionable goals.

**Mission:** "${project.mission}"

Rules:
- Create at most ${remainingSlots} goals
- Each goal should be a clear milestone toward the mission
- Order goals by priority/dependency
- Keep goals achievable (not too broad, not too narrow)

Respond in this EXACT JSON format:
\`\`\`json
{
  "goals": [
    {
      "description": "Goal description",
      "priority": "critical" | "high" | "medium" | "low"
    }
  ]
}
\`\`\`
`;

      const runResult = await session.send(prompt);
      const parsed = parseStreamJson(runResult.stdout);

      const jsonMatch = parsed.text.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) throw new Error("No JSON found in mission analysis response");

      const data = JSON.parse(jsonMatch[1]);
      const goals = (data.goals ?? []).slice(0, remainingSlots);
      const VALID_PRIORITIES = ["critical", "high", "medium", "low"];
      const goalIds: string[] = [];

      for (const g of goals) {
        if (!g.description || typeof g.description !== "string") continue;
        const priority = VALID_PRIORITIES.includes(g.priority) ? g.priority : "medium";
        const result = db.prepare(
          "INSERT INTO goals (project_id, description, priority) VALUES (?, ?, ?)",
        ).run(projectId, g.description.slice(0, 500), priority);
        const row = db.prepare("SELECT id FROM goals WHERE rowid = ?").get(result.lastInsertRowid) as { id: string };
        goalIds.push(row.id);
      }

      log.info(`Full autopilot: created ${goalIds.length} goals from mission`);
      broadcast("project:updated", { projectId });

      db.prepare(
        "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'goal_created', ?)",
      ).run(projectId, ctoAgent.id, `CTO auto-generated ${goalIds.length} goals from mission`);

      // Cleanup CTO session
      sessionManager.killSession(ctoAgent.id);

      return { goalIds };
    },
  };
}

/** Centralized task status transition — single source of truth for status changes + goal progress */
function transitionTask(
  db: Database,
  broadcast: (event: string, data: unknown) => void,
  task: TaskRow,
  newStatus: string,
): void {
  db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newStatus, task.id);
  broadcast("task:updated", { ...task, status: newStatus });
  if (newStatus === "done" && !task.parent_task_id) {
    updateGoalProgress(db, task.goal_id);
  }
}

function updateGoalProgress(db: Database, goalId: string): void {
  const stats = db.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
    FROM tasks WHERE goal_id = ? AND parent_task_id IS NULL
  `).get(goalId) as { total: number; done: number };
  const progress = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  db.prepare("UPDATE goals SET progress = ? WHERE id = ?").run(progress, goalId);
}
