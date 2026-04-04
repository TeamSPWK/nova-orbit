import { useState } from "react";
import { api } from "../lib/api";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  todo: { label: "Todo", color: "text-gray-500", bg: "bg-gray-50" },
  in_progress: { label: "In Progress", color: "text-blue-600", bg: "bg-blue-50" },
  in_review: { label: "In Review", color: "text-purple-600", bg: "bg-purple-50" },
  done: { label: "Done", color: "text-green-600", bg: "bg-green-50" },
  blocked: { label: "Blocked", color: "text-red-600", bg: "bg-red-50" },
};

const STATUSES = ["todo", "in_progress", "in_review", "done", "blocked"];

interface TaskListProps {
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    assignee_id: string | null;
    verification_id: string | null;
  }>;
  agents: Array<{ id: string; name: string }>;
  onUpdate?: () => void;
}

export function TaskList({ tasks, agents, onUpdate }: TaskListProps) {
  const [runningTasks, setRunningTasks] = useState<Set<string>>(new Set());
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  if (tasks.length === 0) {
    return <p className="text-sm text-gray-400">No tasks yet.</p>;
  }

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    await api.tasks.update(taskId, { status: newStatus });
    onUpdate?.();
  };

  const handleRunTask = async (taskId: string) => {
    setRunningTasks((prev) => new Set(prev).add(taskId));
    try {
      await api.orchestration.executeTask(taskId);
    } catch {
      // Error will be broadcast via WebSocket
    }
    // Don't remove from running — WebSocket will update the task status
  };

  const handleAssign = async (taskId: string) => {
    if (agents.length === 0) return;
    const agentName = prompt(
      `Assign to agent:\n${agents.map((a) => `  ${a.name} (${a.id.slice(0, 6)})`).join("\n")}`,
    );
    if (!agentName) return;
    const agent = agents.find(
      (a) => a.name.toLowerCase() === agentName.toLowerCase() || a.id.startsWith(agentName),
    );
    if (!agent) {
      alert("Agent not found");
      return;
    }
    await api.tasks.update(taskId, { assignee_id: agent.id });
    onUpdate?.();
  };

  const groups = STATUSES;

  return (
    <div className="space-y-5">
      {groups.map((status) => {
        const filtered = tasks.filter((t) => t.status === status);
        if (filtered.length === 0) return null;
        const config = STATUS_CONFIG[status];

        return (
          <div key={status}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
              <span className="text-[10px] text-gray-300">{filtered.length}</span>
            </div>
            <div className="space-y-1">
              {filtered.map((task) => (
                <div
                  key={task.id}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 transition-colors dark:bg-gray-800 ${config.bg}`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{task.title}</span>
                    {task.verification_id && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-600 rounded shrink-0">
                        verified
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-3">
                    {/* Agent assignment */}
                    {task.assignee_id && agentMap[task.assignee_id] ? (
                      <span className="text-[10px] text-gray-400 dark:text-gray-400 px-1.5 py-0.5 bg-white dark:bg-gray-700 rounded border border-gray-100 dark:border-gray-600">
                        {agentMap[task.assignee_id].name}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleAssign(task.id)}
                        className="text-[10px] text-gray-300 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300 px-1.5 py-0.5 border border-dashed border-gray-200 dark:border-gray-600 rounded"
                      >
                        assign
                      </button>
                    )}

                    {/* Status dropdown */}
                    <select
                      value={task.status}
                      onChange={(e) => handleStatusChange(task.id, e.target.value)}
                      className="text-[10px] text-gray-400 dark:text-gray-400 bg-transparent dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5 cursor-pointer"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_CONFIG[s].label}
                        </option>
                      ))}
                    </select>

                    {/* Run button — only for assigned tasks in todo/blocked */}
                    {task.assignee_id &&
                      (task.status === "todo" || task.status === "blocked") && (
                        <button
                          onClick={() => handleRunTask(task.id)}
                          disabled={runningTasks.has(task.id)}
                          className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                            runningTasks.has(task.id)
                              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                              : "bg-blue-500 text-white hover:bg-blue-600"
                          }`}
                        >
                          {runningTasks.has(task.id) ? "Running..." : "Run"}
                        </button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
