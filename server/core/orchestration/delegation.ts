import type { Database } from "better-sqlite3";
import type { SessionManager } from "../agent/session.js";
import { parseStreamJson } from "../agent/adapters/stream-parser.js";
import { createLogger } from "../../utils/logger.js";
import { MAX_TITLE_LEN, MAX_DESC_LEN } from "../../utils/constants.js";

const log = createLogger("delegation");

const MAX_SUBTASKS = 5;
const MAX_DELEGATION_DEPTH = 1;

interface AgentRow {
  id: string;
  name: string;
  role: string;
  parent_id: string | null;
}

interface TaskRow {
  id: string;
  goal_id: string;
  project_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  parent_task_id: string | null;
  status: string;
}

export interface DelegationResult {
  delegated: boolean;
  subtaskIds: string[];
}

/**
 * Hierarchical Delegation Engine.
 *
 * When a task is assigned to an agent that has subordinates (children),
 * the agent decomposes the task into subtasks and delegates to children.
 *
 * Safety:
 * - Max 5 subtasks per delegation
 * - Max 1 level of delegation depth (prevents infinite recursion)
 * - Delegation failure → fallback to direct execution
 * - Subtask failure → parent task blocked
 */
function updateGoalProgress(db: Database, goalId: string): void {
  const stats = db.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
    FROM tasks WHERE goal_id = ? AND parent_task_id IS NULL
  `).get(goalId) as { total: number; done: number };
  const progress = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  db.prepare("UPDATE goals SET progress = ? WHERE id = ?").run(progress, goalId);
}

export function createDelegationEngine(
  db: Database,
  sessionManager: SessionManager,
  broadcast: (event: string, data: unknown) => void,
) {
  return {
    /**
     * Attempt to delegate a task to the assignee's subordinates.
     * Returns { delegated: false } if no subordinates or delegation not appropriate.
     */
    async attemptDelegation(taskId: string): Promise<DelegationResult> {
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (!task.assignee_id) return { delegated: false, subtaskIds: [] };

      // Guard: don't delegate subtasks (prevent recursion)
      if (task.parent_task_id !== null) {
        return { delegated: false, subtaskIds: [] };
      }

      // Check delegation depth — count parent chain
      let depth = 0;
      let current: string | null = task.parent_task_id;
      while (current) {
        depth++;
        if (depth > MAX_DELEGATION_DEPTH) {
          log.warn(`Delegation depth exceeded for task ${taskId}, executing directly`);
          return { delegated: false, subtaskIds: [] };
        }
        const parent = db.prepare("SELECT parent_task_id FROM tasks WHERE id = ?").get(current) as { parent_task_id: string | null } | undefined;
        current = parent?.parent_task_id ?? null;
      }

      // Find subordinates of the assignee
      const subordinates = db.prepare(
        "SELECT * FROM agents WHERE parent_id = ? AND project_id = (SELECT project_id FROM agents WHERE id = ?)",
      ).all(task.assignee_id, task.assignee_id) as AgentRow[];

      if (subordinates.length === 0) {
        return { delegated: false, subtaskIds: [] };
      }

      log.info(`Attempting delegation for task "${task.title}" — ${subordinates.length} subordinates available`);

      // Ask the parent agent to decompose the task for its team
      const parentAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(task.assignee_id) as AgentRow | undefined;
      if (!parentAgent) return { delegated: false, subtaskIds: [] };

      const project = db.prepare("SELECT workdir FROM projects WHERE id = ?").get(task.project_id) as { workdir: string } | undefined;
      const workdir = project?.workdir || process.cwd();

      let session;
      try {
        session = sessionManager.spawnAgent(parentAgent.id, workdir);
      } catch (err: any) {
        log.error(`Failed to spawn agent for delegation: ${err.message}`);
        return { delegated: false, subtaskIds: [] };
      }

      const subordinateList = subordinates.map((s) => `- ${s.name} (${s.role})`).join("\n");

      const prompt = `
# Task Delegation

You are "${parentAgent.name}" (${parentAgent.role}). You need to delegate the following task to your team members.

**Task:** ${task.title}
**Description:** ${task.description}

**Your team:**
${subordinateList}

Rules:
- Break the task into at most ${MAX_SUBTASKS} subtasks
- Each subtask must be assignable to one of your team members
- Specify which team member should handle each subtask by their role
- Keep subtasks focused and concrete

Respond in this EXACT JSON format:
\`\`\`json
{
  "subtasks": [
    {
      "title": "Subtask title",
      "description": "What to do",
      "role": "team member's role"
    }
  ]
}
\`\`\`
`;

      try {
        const result = await session.send(prompt);
        const parsed = parseStreamJson(result.stdout);

        const jsonMatch = parsed.text.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch) {
          log.warn("No JSON in delegation response, falling back to direct execution");
          return { delegated: false, subtaskIds: [] };
        }

        const data = JSON.parse(jsonMatch[1]);
        const subtasks = (data.subtasks ?? []).slice(0, MAX_SUBTASKS);

        if (subtasks.length === 0) {
          return { delegated: false, subtaskIds: [] };
        }

        // Create subtasks and assign to subordinates
        const findSubordinate = (role: string) =>
          subordinates.find((s) => s.role === role) ??
          subordinates[0]; // fallback to first subordinate

        const subtaskIds: string[] = [];

        for (const st of subtasks) {
          if (!st.title || typeof st.title !== "string") continue;
          const assignee = findSubordinate(st.role ?? subordinates[0].role);
          const row = db.prepare(`
            INSERT INTO tasks (goal_id, project_id, title, description, assignee_id, parent_task_id)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id
          `).get(
            task.goal_id,
            task.project_id,
            st.title.slice(0, MAX_TITLE_LEN),
            (st.description ?? "").slice(0, MAX_DESC_LEN),
            assignee.id,
            taskId,
          ) as { id: string };
          subtaskIds.push(row.id);
        }

        log.info(`Delegated task "${task.title}" into ${subtaskIds.length} subtasks`);

        // Mark parent task as in_progress (subtasks will drive completion)
        db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").run(taskId);

        broadcast("task:delegated", {
          taskId,
          parentAgentId: parentAgent.id,
          parentAgentName: parentAgent.name,
          subtaskCount: subtaskIds.length,
          subtaskIds,
        });
        broadcast("project:updated", { projectId: task.project_id });

        db.prepare(
          "INSERT INTO activities (project_id, agent_id, type, message) VALUES (?, ?, 'task_delegated', ?)",
        ).run(task.project_id, parentAgent.id, `${parentAgent.name} delegated "${task.title}" into ${subtaskIds.length} subtasks`);

        return { delegated: true, subtaskIds };
      } catch (err: any) {
        log.error(`Delegation failed for task "${task.title}": ${err.message}`);
        // Fallback: execute directly without delegation
        return { delegated: false, subtaskIds: [] };
      } finally {
        // Reset parent agent status
        db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?").run(parentAgent.id);
        broadcast("agent:status", { id: parentAgent.id, name: parentAgent.name, status: "idle" });
      }
    },

    /**
     * Check if all subtasks of a parent task are done.
     * If so, mark the parent as done. If any are blocked/failed, mark parent as blocked.
     */
    checkParentCompletion(parentTaskId: string): void {
      const subtasks = db.prepare(
        "SELECT status FROM tasks WHERE parent_task_id = ?",
      ).all(parentTaskId) as { status: string }[];

      if (subtasks.length === 0) return;

      const allDone = subtasks.every((s) => s.status === "done");
      const anyBlocked = subtasks.some((s) => s.status === "blocked");
      const allFinished = subtasks.every((s) => s.status === "done" || s.status === "blocked");

      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(parentTaskId) as TaskRow;
      if (!task) return;

      if (allDone) {
        db.prepare("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?")
          .run(parentTaskId);
        broadcast("task:updated", { ...task, status: "done" });
        updateGoalProgress(db, task.goal_id);
        log.info(`Parent task ${parentTaskId} completed — all subtasks done`);
      } else if (anyBlocked && allFinished) {
        // Only block parent when all subtasks have finished (some done, some blocked)
        db.prepare("UPDATE tasks SET status = 'blocked', updated_at = datetime('now') WHERE id = ?")
          .run(parentTaskId);
        broadcast("task:updated", { ...task, status: "blocked" });
        log.warn(`Parent task ${parentTaskId} blocked — subtask(s) failed`);
      }
      // else: subtasks still in progress/in_review — do nothing, wait for next check
    },
  };
}
