import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Activity {
  id: number;
  type: string;
  message: string;
  agent_id: string | null;
  created_at: string;
}

interface ActivityFeedProps {
  projectId: string;
}

const TYPE_ICONS: Record<string, string> = {
  task_started: "▶",
  task_completed: "✅",
  verification_pass: "✔",
  verification_fail: "✗",
  agent_started: "🤖",
  agent_stopped: "⏹",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ActivityFeed({ projectId }: ActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial load from REST API
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.activities
      .list(projectId)
      .then((data) => {
        setActivities(data);
      })
      .catch(() => {
        setActivities([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId]);

  // Prepend real-time WebSocket events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.type) return;

      const newActivity: Activity = {
        id: Date.now(),
        type: detail.type,
        message: typeof detail.payload === "string"
          ? detail.payload
          : (detail.payload?.message ?? JSON.stringify(detail.payload).slice(0, 120)),
        agent_id: detail.payload?.agent_id ?? null,
        created_at: new Date().toISOString(),
      };

      setActivities((prev) => [newActivity, ...prev].slice(0, 50));
    };

    window.addEventListener("nova:refresh", handler);
    return () => window.removeEventListener("nova:refresh", handler);
  }, []);

  if (loading) {
    return <p className="text-xs text-gray-400 italic">Loading activity...</p>;
  }

  if (activities.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        No activity yet. Activity will appear here when agents run tasks.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {activities.map((a) => (
        <div key={a.id} className="flex items-start gap-2 text-xs">
          <span className="shrink-0 w-4 text-center">
            {TYPE_ICONS[a.type] ?? "•"}
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-gray-700 break-words">{a.message}</span>
          </div>
          <span className="shrink-0 text-gray-300 tabular-nums">
            {formatTime(a.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
