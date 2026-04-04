import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { TaskDetail } from "./TaskDetail";
import { RejectDialog } from "./RejectDialog";

const STATUSES = ["todo", "in_progress", "in_review", "done", "blocked"];

const STATUS_LABEL_KEYS: Record<string, string> = {
  todo: "statusTodo",
  in_progress: "statusInProgress",
  in_review: "statusInReview",
  done: "statusDone",
  blocked: "statusBlocked",
};

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  todo: { color: "text-gray-500", bg: "bg-gray-50" },
  in_progress: { color: "text-blue-600", bg: "bg-blue-50" },
  in_review: { color: "text-purple-600", bg: "bg-purple-50" },
  done: { color: "text-green-600", bg: "bg-green-50" },
  blocked: { color: "text-red-600", bg: "bg-red-50" },
};

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
  projectId?: string;
  onUpdate?: () => void;
}

export function TaskList({ tasks, agents, projectId, onUpdate }: TaskListProps) {
  const { t } = useTranslation();
  const [runningTasks, setRunningTasks] = useState<Set<string>>(new Set());
  const [verifyingTasks, setVerifyingTasks] = useState<Set<string>>(new Set());
  const [elapsedSeconds, setElapsedSeconds] = useState<Record<string, number>>({});
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [rejectingTask, setRejectingTask] = useState<{ id: string; title: string } | null>(null);
  const [taskUsage, setTaskUsage] = useState<Map<string, { costUsd: number; totalTokens: number }>>(new Map());
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  // Per-task interval refs for elapsed time counters
  const intervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // Accumulate usage per task from WebSocket events
  useEffect(() => {
    const handler = (e: Event) => {
      const payload = (e as CustomEvent<{ taskId: string; costUsd: number; totalTokens: number }>).detail;
      if (!payload.taskId) return;
      setTaskUsage((prev) => {
        const next = new Map(prev);
        next.set(payload.taskId, { costUsd: payload.costUsd, totalTokens: payload.totalTokens });
        return next;
      });
    };
    window.addEventListener("nova:task-usage", handler);
    return () => window.removeEventListener("nova:task-usage", handler);
  }, []);

  // Clear timers for tasks that are no longer running (status changed via WebSocket)
  useEffect(() => {
    const handler = () => {
      // When a refresh arrives, tasks prop will update — stop timers for completed tasks
      setRunningTasks((prev) => {
        const stillRunning = new Set<string>();
        prev.forEach((id) => {
          const task = tasks.find((t) => t.id === id);
          if (task && (task.status === "todo" || task.status === "blocked" || task.status === "in_progress")) {
            stillRunning.add(id);
          } else {
            clearInterval(intervalsRef.current[id]);
            delete intervalsRef.current[id];
          }
        });
        return stillRunning;
      });
      // Clear verifying state for tasks that now have verification or changed status
      setVerifyingTasks((prev) => {
        const still = new Set<string>();
        prev.forEach((id) => {
          const task = tasks.find((t) => t.id === id);
          if (task && task.status === "in_review" && !task.verification_id) {
            still.add(id);
          }
        });
        return still;
      });
    };
    window.addEventListener("nova:refresh", handler);
    return () => window.removeEventListener("nova:refresh", handler);
  }, [tasks]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      Object.values(intervalsRef.current).forEach(clearInterval);
    };
  }, []);

  if (tasks.length === 0) {
    return (
      <div className="py-8 px-4 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg text-center">
        <div className="text-3xl mb-2 opacity-40">📋</div>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
          {t("emptyTasksTitle")}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t("emptyTasksDesc")}
        </p>
      </div>
    );
  }

  const handleTaskClick = (e: React.MouseEvent, taskId: string) => {
    // Don't open modal if clicking on interactive controls inside the row
    const target = e.target as HTMLElement;
    if (target.closest("select") || target.closest("button")) return;
    setSelectedTaskId(taskId);
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    await api.tasks.update(taskId, { status: newStatus });
    onUpdate?.();
  };

  const handleRunTask = async (taskId: string) => {
    setRunningTasks((prev) => new Set(prev).add(taskId));
    setElapsedSeconds((prev) => ({ ...prev, [taskId]: 0 }));
    intervalsRef.current[taskId] = setInterval(() => {
      setElapsedSeconds((prev) => ({ ...prev, [taskId]: (prev[taskId] ?? 0) + 1 }));
    }, 1000);
    try {
      await api.orchestration.executeTask(taskId);
    } catch {
      // Error will be broadcast via WebSocket
    }
  };

  const handleReject = async (taskId: string, feedback: string, autoRerun: boolean) => {
    setRejectingTask(null);
    await api.tasks.reject(taskId, feedback || undefined);
    onUpdate?.();

    // Auto-rerun: wait for status to go back to todo, then execute
    if (autoRerun) {
      // Small delay to let the status update propagate
      setTimeout(() => handleRunTask(taskId), 500);
    }
  };

  const handleAssignSelect = async (taskId: string, agentId: string) => {
    setAssigningTaskId(null);
    if (!agentId) return;
    await api.tasks.update(taskId, { assignee_id: agentId });
    onUpdate?.();
  };

  return (
    <>
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          agents={agents}
          onClose={() => setSelectedTaskId(null)}
          onUpdate={() => { setSelectedTaskId(null); onUpdate?.(); }}
        />
      )}
      {rejectingTask && (
        <RejectDialog
          taskTitle={rejectingTask.title}
          onReject={(fb, autoRerun) => handleReject(rejectingTask.id, fb, autoRerun)}
          onCancel={() => setRejectingTask(null)}
        />
      )}
    <div className="space-y-5">
      {STATUSES.map((status) => {
        const filtered = tasks.filter((task) => task.status === status);
        if (filtered.length === 0) return null;
        const config = STATUS_COLORS[status];
        const labelKey = STATUS_LABEL_KEYS[status];

        return (
          <div key={status}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs font-medium ${config.color}`}>{t(labelKey)}</span>
              <span className="text-[10px] text-gray-300">{filtered.length}</span>
              {status === "in_review" && filtered.length > 1 && projectId && (
                <button
                  onClick={async () => {
                    await api.tasks.bulkApprove(projectId);
                    onUpdate?.();
                  }}
                  className="text-[10px] px-2 py-0.5 rounded font-medium bg-green-500 text-white hover:bg-green-600 ml-auto"
                >
                  {t("bulkApprove", { count: filtered.length })}
                </button>
              )}
            </div>
            <div className="space-y-1">
              {filtered.map((task) => {
                const isRunning = runningTasks.has(task.id);
                const seconds = elapsedSeconds[task.id] ?? 0;
                const usage = taskUsage.get(task.id);
                return (
                <div
                  key={task.id}
                  onClick={(e) => handleTaskClick(e, task.id)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors dark:bg-gray-800 cursor-pointer ${
                    isRunning
                      ? "border-blue-400 dark:border-blue-500 animate-pulse"
                      : `border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600`
                  } ${config.bg}`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{task.title}</span>
                    {task.verification_id && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-600 rounded shrink-0">
                        {t("verified")}
                      </span>
                    )}
                    {task.status === "todo" && task.description?.includes("--- Rejection Feedback ---") && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 rounded shrink-0">
                        {t("rejected")}
                      </span>
                    )}
                    {task.status === "done" && usage && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded shrink-0">
                        ${usage.costUsd.toFixed(2)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-3">
                    {/* Agent assignment */}
                    {task.assignee_id && agentMap[task.assignee_id] ? (
                      <span className="text-[10px] text-gray-400 dark:text-gray-400 px-1.5 py-0.5 bg-white dark:bg-gray-700 rounded border border-gray-100 dark:border-gray-600">
                        {agentMap[task.assignee_id].name}
                      </span>
                    ) : assigningTaskId === task.id ? (
                      <select
                        autoFocus
                        defaultValue=""
                        onChange={(e) => handleAssignSelect(task.id, e.target.value)}
                        onBlur={() => setAssigningTaskId(null)}
                        className="text-[10px] text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-blue-300 dark:border-blue-600 rounded px-1 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="" disabled>{t("promptAssignAgent")}</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => setAssigningTaskId(task.id)}
                        className="text-[10px] text-gray-300 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300 px-1.5 py-0.5 border border-dashed border-gray-200 dark:border-gray-600 rounded"
                      >
                        {t("assign")}
                      </button>
                    )}

                    {/* Status dropdown */}
                    <select
                      aria-label={t("taskStatus")}
                      value={task.status}
                      onChange={(e) => handleStatusChange(task.id, e.target.value)}
                      className="text-[10px] text-gray-400 dark:text-gray-400 bg-transparent dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5 cursor-pointer"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(STATUS_LABEL_KEYS[s])}
                        </option>
                      ))}
                    </select>

                    {/* Governance: Verify → Approve/Reject for in_review tasks */}
                    {task.status === "in_review" && (
                      <>
                        {task.verification_id ? (
                          <>
                            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded">
                              {t("verified")}
                            </span>
                            <button
                              onClick={async () => { await api.tasks.approve(task.id); onUpdate?.(); }}
                              className="text-[10px] px-2 py-0.5 rounded font-medium bg-green-500 text-white hover:bg-green-600"
                            >
                              {t("approve")}
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded">
                              {t("unverified")}
                            </span>
                            <button
                              onClick={async () => {
                                setVerifyingTasks((prev) => new Set(prev).add(task.id));
                                try {
                                  await api.orchestration.verifyTask(task.id);
                                } catch { /* result comes via WebSocket */ }
                              }}
                              disabled={verifyingTasks.has(task.id)}
                              className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                                verifyingTasks.has(task.id)
                                  ? "bg-purple-50 dark:bg-purple-900/30 text-purple-400 cursor-not-allowed"
                                  : "bg-purple-500 text-white hover:bg-purple-600"
                              }`}
                            >
                              {verifyingTasks.has(task.id) ? t("verifying") : t("verify")}
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => setRejectingTask({ id: task.id, title: task.title })}
                          className="text-[10px] px-2 py-0.5 rounded font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50"
                        >
                          {t("reject")}
                        </button>
                      </>
                    )}

                    {/* Run button — only for assigned tasks in todo/blocked */}
                    {task.assignee_id &&
                      (task.status === "todo" || task.status === "blocked") && (
                        <button
                          onClick={() => handleRunTask(task.id)}
                          disabled={isRunning}
                          className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors flex items-center gap-1 ${
                            isRunning
                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400 cursor-not-allowed"
                              : "bg-blue-500 text-white hover:bg-blue-600"
                          }`}
                        >
                          {isRunning ? (
                            <>
                              <svg
                                className="animate-spin w-2.5 h-2.5 shrink-0"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8v8H4z"
                                />
                              </svg>
                              {t("taskRunning", { seconds })}
                            </>
                          ) : (
                            t("run")
                          )}
                        </button>
                      )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
    </>
  );
}
