import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { AgentTerminal } from "./AgentTerminal";

interface Agent {
  id: string;
  name: string;
  role: string;
  status: string;
  current_task_id: string | null;
  system_prompt?: string;
  session_id?: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  verification_id: string | null;
}

interface AgentDetailProps {
  agent: Agent;
  tasks: Task[];
  onClose: () => void;
  onKill: () => void;
}

const ROLE_ICONS: Record<string, string> = {
  coder: "\uD83D\uDCBB",
  reviewer: "\uD83D\uDD0D",
  marketer: "\uD83D\uDCE3",
  designer: "\uD83C\uDFA8",
  qa: "\uD83E\uDDEA",
  custom: "\u2699\uFE0F",
};

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
  working: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 animate-pulse",
  waiting_approval: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
  paused: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  terminated: "bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400",
};

export function AgentDetail({ agent, tasks, onClose, onKill }: AgentDetailProps) {
  const { t } = useTranslation();
  const [promptExpanded, setPromptExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const agentTasks = tasks.filter((t) => t.assignee_id === agent.id);
  const currentTask = tasks.find((t) => t.id === agent.current_task_id);
  const passCount = agentTasks.filter((t) => t.verification_id !== null).length;
  const failCount = agentTasks.filter(
    (t) => t.status === "blocked" && t.verification_id === null
  ).length;

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleKill = async () => {
    if (!confirm(`Kill agent "${agent.name}"?`)) return;
    await api.orchestration.killAgent(agent.id);
    onKill();
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40" />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed top-0 right-0 h-full w-[400px] bg-white dark:bg-[#1e1e35] border-l border-gray-200 dark:border-gray-700 z-50 flex flex-col shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{ROLE_ICONS[agent.role] ?? "\u2699\uFE0F"}</span>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {agent.name}
              </h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">{agent.role}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Status + Session */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-3">
              Session Info
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">Status</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                    STATUS_COLORS[agent.status] ?? STATUS_COLORS.idle
                  }`}
                >
                  {agent.status.replace(/_/g, " ")}
                </span>
              </div>
              {agent.session_id && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Session ID</span>
                  <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">
                    {agent.session_id.slice(0, 12)}...
                  </span>
                </div>
              )}
              {currentTask && (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Current Task</span>
                  <span className="text-xs text-gray-700 dark:text-gray-300 text-right">
                    {currentTask.title}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Live Terminal — only while working */}
          {agent.status === "working" && (
            <AgentTerminal agentId={agent.id} />
          )}

          {/* System Prompt */}
          {agent.system_prompt && (
            <section>
              <button
                onClick={() => setPromptExpanded((v) => !v)}
                className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-2 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <span>System Prompt</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform ${promptExpanded ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {promptExpanded && (
                <pre className="text-[11px] text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed border border-gray-100 dark:border-gray-700">
                  {agent.system_prompt}
                </pre>
              )}
            </section>
          )}

          {/* Verification Stats */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-3">
              Verification Stats
            </h3>
            <div className="flex gap-3">
              <div className="flex-1 bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center border border-green-100 dark:border-green-800/30">
                <div className="text-xl font-bold text-green-600 dark:text-green-400">
                  {passCount}
                </div>
                <div className="text-[10px] text-green-500 dark:text-green-500 mt-0.5">Verified</div>
              </div>
              <div className="flex-1 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center border border-red-100 dark:border-red-800/30">
                <div className="text-xl font-bold text-red-500 dark:text-red-400">
                  {failCount}
                </div>
                <div className="text-[10px] text-red-400 dark:text-red-500 mt-0.5">Blocked</div>
              </div>
              <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center border border-gray-100 dark:border-gray-700">
                <div className="text-xl font-bold text-gray-600 dark:text-gray-300">
                  {agentTasks.length}
                </div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Total</div>
              </div>
            </div>
          </section>

          {/* Task History */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-3">
              Task History ({agentTasks.length})
            </h3>
            {agentTasks.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">No tasks assigned yet.</p>
            ) : (
              <div className="space-y-1.5">
                {agentTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700"
                  >
                    <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">
                      {task.title}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {task.verification_id && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded">
                          verified
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 capitalize">
                        {task.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        {agent.status === "working" && (
          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
            <button
              onClick={handleKill}
              className="w-full py-2 text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              Kill Session
            </button>
          </div>
        )}
      </div>
    </>
  );
}
