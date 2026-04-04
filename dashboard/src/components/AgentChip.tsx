import { AgentAvatar } from "./AgentAvatar";

interface AgentChipProps {
  agent: {
    id: string;
    name: string;
    role: string;
    status: string;
  };
  onClick?: () => void;
}

const STATUS_DOT: Record<string, string> = {
  working: "bg-green-400 animate-pulse",
  paused: "bg-yellow-400",
  idle: "bg-gray-300 dark:bg-gray-600",
};

export function AgentChip({ agent, onClick }: AgentChipProps) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-colors text-left ${
        agent.status === "working"
          ? "border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#25253d] hover:border-gray-300 dark:hover:border-gray-600"
      }`}
    >
      <AgentAvatar name={agent.name} role={agent.role} size="xs" />
      <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate max-w-[80px]">
        {agent.name}
      </span>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[agent.status] ?? STATUS_DOT.idle}`} />
    </button>
  );
}
