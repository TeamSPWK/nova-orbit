import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

const ROLE_ICONS: Record<string, string> = {
  coder: "\uD83D\uDCBB",
  reviewer: "\uD83D\uDD0D",
  marketer: "\uD83D\uDCE3",
  designer: "\uD83C\uDFA8",
  qa: "\uD83E\uDDEA",
  custom: "\u2699\uFE0F",
};

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400",
  working: "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 animate-pulse",
  waiting_approval: "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-600 dark:text-yellow-400",
  paused: "bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400",
  terminated: "bg-red-100 dark:bg-red-900/40 text-red-500 dark:text-red-400",
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  idle: "statusIdle",
  working: "statusWorking",
  waiting_approval: "statusWaitingApproval",
  paused: "statusPaused",
  terminated: "statusTerminated",
};

interface AgentCardProps {
  agent: {
    id: string;
    name: string;
    role: string;
    status: string;
    current_task_id: string | null;
  };
  tasks?: Array<{ id: string; title: string }>;
  onKill?: () => void;
  onClick?: () => void;
}

export function AgentCard({ agent, tasks, onKill, onClick }: AgentCardProps) {
  const { t } = useTranslation();
  const currentTask = tasks?.find((task) => task.id === agent.current_task_id);

  const handleKill = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Kill agent "${agent.name}"?`)) return;
    await api.orchestration.killAgent(agent.id);
    onKill?.();
  };

  const statusLabelKey = STATUS_LABEL_KEYS[agent.status] ?? "statusIdle";

  return (
    <div
      className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-[#25253d] transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{ROLE_ICONS[agent.role] ?? "\u2699\uFE0F"}</span>
          <div>
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{agent.name}</div>
            <div className="text-xs text-gray-400 dark:text-gray-500 capitalize">{agent.role}</div>
          </div>
        </div>
        {agent.status === "working" && (
          <button
            onClick={handleKill}
            className="text-[10px] px-1.5 py-0.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
            title="Kill session"
          >
            {t("stopAgent")}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            STATUS_COLORS[agent.status] ?? STATUS_COLORS.idle
          }`}
        >
          {t(statusLabelKey)}
        </span>
        {currentTask && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
            {currentTask.title}
          </span>
        )}
      </div>
    </div>
  );
}
