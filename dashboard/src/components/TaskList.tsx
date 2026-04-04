const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  todo: { label: "Todo", color: "text-gray-500", bg: "bg-gray-100" },
  in_progress: { label: "In Progress", color: "text-blue-600", bg: "bg-blue-50" },
  in_review: { label: "In Review", color: "text-purple-600", bg: "bg-purple-50" },
  done: { label: "Done", color: "text-green-600", bg: "bg-green-50" },
  blocked: { label: "Blocked", color: "text-red-600", bg: "bg-red-50" },
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
  agents: Array<{
    id: string;
    name: string;
  }>;
}

export function TaskList({ tasks, agents }: TaskListProps) {
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  if (tasks.length === 0) {
    return <p className="text-sm text-gray-400">No tasks yet.</p>;
  }

  // Group by status
  const groups = ["todo", "in_progress", "in_review", "blocked", "done"];

  return (
    <div className="space-y-4">
      {groups.map((status) => {
        const filtered = tasks.filter((t) => t.status === status);
        if (filtered.length === 0) return null;
        const config = STATUS_CONFIG[status];

        return (
          <div key={status}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs font-medium ${config.color}`}>
                {config.label}
              </span>
              <span className="text-[10px] text-gray-300">{filtered.length}</span>
            </div>
            <div className="space-y-1">
              {filtered.map((task) => (
                <div
                  key={task.id}
                  className={`flex items-center justify-between px-3 py-2 rounded border border-gray-100 hover:border-gray-200 transition-colors ${config.bg}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-800 truncate">
                      {task.title}
                    </span>
                    {task.verification_id && (
                      <span className="text-[10px] px-1 py-0.5 bg-green-100 text-green-600 rounded shrink-0">
                        verified
                      </span>
                    )}
                  </div>
                  {task.assignee_id && agentMap[task.assignee_id] && (
                    <span className="text-[10px] text-gray-400 shrink-0 ml-2">
                      {agentMap[task.assignee_id].name}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
