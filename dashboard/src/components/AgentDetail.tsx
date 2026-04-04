import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { AgentTerminal } from "./AgentTerminal";
import { ConfirmDialog } from "./ConfirmDialog";
import { AgentAvatar } from "./AgentAvatar";

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
  onDeleted?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
  working: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 animate-pulse",
  waiting_approval: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
  paused: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  terminated: "bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400",
};

export function AgentDetail({ agent, tasks, onClose, onKill, onDeleted }: AgentDetailProps) {
  const { t } = useTranslation();
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(agent.system_prompt ?? "");
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Direct prompt state
  const [directMessage, setDirectMessage] = useState("");
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);
  const [promptResult, setPromptResult] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const directTextareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleKillConfirm = async () => {
    setShowKillConfirm(false);
    await api.orchestration.killAgent(agent.id);
    onKill();
  };

  const handleDeleteConfirm = async () => {
    setShowDeleteConfirm(false);
    await api.agents.delete(agent.id);
    onDeleted?.();
    onClose();
  };

  const handleSavePrompt = async () => {
    setIsSavingPrompt(true);
    try {
      await api.agents.update(agent.id, { system_prompt: editedPrompt });
      setIsEditingPrompt(false);
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleCancelPromptEdit = () => {
    setEditedPrompt(agent.system_prompt ?? "");
    setIsEditingPrompt(false);
  };

  // Listen for prompt-complete events scoped to this agent
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ agentId: string; result: string | null; error?: string }>).detail;
      if (detail.agentId !== agent.id) return;
      setIsSendingPrompt(false);
      if (detail.error) {
        setPromptError(detail.error);
      } else {
        setPromptResult(detail.result ?? "");
      }
    };
    window.addEventListener("nova:prompt-complete", handler);
    return () => window.removeEventListener("nova:prompt-complete", handler);
  }, [agent.id]);

  const handleSendDirectPrompt = useCallback(async () => {
    const msg = directMessage.trim();
    if (!msg || isSendingPrompt) return;
    setIsSendingPrompt(true);
    setPromptResult(null);
    setPromptError(null);
    try {
      await api.orchestration.sendPrompt(agent.id, msg);
      setDirectMessage("");
    } catch (err: any) {
      setIsSendingPrompt(false);
      setPromptError(err.message ?? t("promptSendError"));
    }
  }, [directMessage, isSendingPrompt, agent.id, t]);

  const handleDirectKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSendDirectPrompt();
    }
  };

  // Auto-resize textarea
  const handleDirectInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDirectMessage(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <>
      {showKillConfirm && (
        <ConfirmDialog
          message={t("confirmKillAgent")}
          onConfirm={handleKillConfirm}
          onCancel={() => setShowKillConfirm(false)}
        />
      )}
      {showDeleteConfirm && (
        <ConfirmDialog
          message={t("deleteAgentConfirm")}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

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
            <AgentAvatar name={agent.name} role={agent.role} size="lg" />
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
              {t("agentDetailSessionInfo")}
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">{t("agentDetailStatus")}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                    STATUS_COLORS[agent.status] ?? STATUS_COLORS.idle
                  }`}
                >
                  {t({
                    idle: "statusIdle",
                    working: "statusWorking",
                    waiting_approval: "statusWaitingApproval",
                    paused: "statusPaused",
                    terminated: "statusTerminated",
                  }[agent.status] ?? "statusIdle")}
                </span>
              </div>
              {agent.session_id && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t("agentDetailSessionId")}</span>
                  <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">
                    {agent.session_id.slice(0, 12)}...
                  </span>
                </div>
              )}
              {currentTask && (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{t("agentDetailCurrentTask")}</span>
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
          <section>
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setPromptExpanded((v) => !v)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <span>{t("systemPrompt")}</span>
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
              {!isEditingPrompt && (
                <button
                  onClick={() => { setPromptExpanded(true); setIsEditingPrompt(true); }}
                  className="text-[10px] text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
                >
                  {t("editPrompt")}
                </button>
              )}
            </div>
            {promptExpanded && (
              <>
                {isEditingPrompt ? (
                  <div className="space-y-2">
                    <textarea
                      value={editedPrompt}
                      onChange={(e) => setEditedPrompt(e.target.value)}
                      rows={8}
                      className="w-full text-[11px] text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono leading-relaxed border border-blue-300 dark:border-blue-600 focus:outline-none focus:border-blue-400 resize-y"
                    />
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                      {t("promptHint")}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSavePrompt}
                        disabled={isSavingPrompt}
                        className="px-3 py-1 text-[11px] bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
                      >
                        {t("savePrompt")}
                      </button>
                      <button
                        onClick={handleCancelPromptEdit}
                        className="px-3 py-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre className="text-[11px] text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed border border-gray-100 dark:border-gray-700">
                    {editedPrompt || <span className="text-gray-300 dark:text-gray-600 italic">—</span>}
                  </pre>
                )}
              </>
            )}
          </section>

          {/* Verification Stats */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-3">
              {t("agentDetailVerificationStats")}
            </h3>
            <div className="flex gap-3">
              <div className="flex-1 bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center border border-green-100 dark:border-green-800/30">
                <div className="text-xl font-bold text-green-600 dark:text-green-400">
                  {passCount}
                </div>
                <div className="text-[10px] text-green-500 dark:text-green-500 mt-0.5">{t("agentDetailVerified")}</div>
              </div>
              <div className="flex-1 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center border border-red-100 dark:border-red-800/30">
                <div className="text-xl font-bold text-red-500 dark:text-red-400">
                  {failCount}
                </div>
                <div className="text-[10px] text-red-400 dark:text-red-500 mt-0.5">{t("agentDetailBlocked")}</div>
              </div>
              <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center border border-gray-100 dark:border-gray-700">
                <div className="text-xl font-bold text-gray-600 dark:text-gray-300">
                  {agentTasks.length}
                </div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{t("agentDetailTotal")}</div>
              </div>
            </div>
          </section>

          {/* Task History */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-3">
              {t("agentDetailTaskHistory")} ({agentTasks.length})
            </h3>
            {agentTasks.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">{t("agentDetailNoTasks")}</p>
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
                          {t("verified")}
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
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0 space-y-3">
          {/* Direct Prompt Input */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-1.5">
              {t("directPromptTitle")}
            </p>
            <div className="flex flex-col gap-1.5">
              <textarea
                ref={directTextareaRef}
                value={directMessage}
                onChange={handleDirectInput}
                onKeyDown={handleDirectKeyDown}
                disabled={isSendingPrompt || agent.status === "working"}
                placeholder={t("promptPlaceholder")}
                rows={2}
                className="w-full text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
                style={{ minHeight: "56px" }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  Cmd+Enter
                </span>
                <button
                  onClick={handleSendDirectPrompt}
                  disabled={isSendingPrompt || !directMessage.trim() || agent.status === "working"}
                  className="px-3 py-1 text-xs font-medium bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {isSendingPrompt ? t("promptRunning") : t("sendPrompt")}
                </button>
              </div>
              {promptError && (
                <p className="text-[11px] text-red-500 dark:text-red-400">{promptError}</p>
              )}
              {promptResult !== null && !isSendingPrompt && (
                <div className="text-[10px] px-2 py-1 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded border border-green-100 dark:border-green-800/30">
                  {t("promptComplete")}
                </div>
              )}
            </div>
          </div>

          {/* Kill / Delete buttons */}
          <div className="space-y-2">
            {agent.status === "working" && (
              <button
                onClick={() => setShowKillConfirm(true)}
                className="w-full py-2 text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                {t("agentDetailKillSession")}
              </button>
            )}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full py-2 text-sm font-medium text-red-700 dark:text-red-500 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              {t("deleteAgent")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
