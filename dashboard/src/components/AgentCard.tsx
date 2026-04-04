const ROLE_ICONS: Record<string, string> = {
  coder: "\uD83D\uDCBB",
  reviewer: "\uD83D\uDD0D",
  marketer: "\uD83D\uDCE3",
  designer: "\uD83C\uDFA8",
  qa: "\uD83E\uDDEA",
  custom: "\u2699\uFE0F",
};

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-100 text-gray-500",
  working: "bg-green-100 text-green-600",
  waiting_approval: "bg-yellow-100 text-yellow-600",
  paused: "bg-orange-100 text-orange-600",
  terminated: "bg-red-100 text-red-500",
};

interface AgentCardProps {
  agent: {
    id: string;
    name: string;
    role: string;
    status: string;
    current_task_id: string | null;
  };
}

export function AgentCard({ agent }: AgentCardProps) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 hover:border-gray-300 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{ROLE_ICONS[agent.role] ?? "\u2699\uFE0F"}</span>
        <div>
          <div className="text-sm font-medium text-gray-800">{agent.name}</div>
          <div className="text-xs text-gray-400 capitalize">{agent.role}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            STATUS_COLORS[agent.status] ?? STATUS_COLORS.idle
          }`}
        >
          {agent.status.replace("_", " ")}
        </span>
        {agent.current_task_id && (
          <span className="text-[10px] text-gray-400 truncate">
            Working on task...
          </span>
        )}
      </div>
    </div>
  );
}
