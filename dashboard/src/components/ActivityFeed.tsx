import { useEffect, useState } from "react";

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
  task_started: "\u25B6\uFE0F",
  task_completed: "\u2705",
  verification_pass: "\u2714\uFE0F",
  verification_fail: "\u274C",
};

export function ActivityFeed({ projectId }: ActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then(() => {
        // Load activities — use a simple endpoint
        // For now, we'll listen to WebSocket events
      });
  }, [projectId]);

  // Listen to WebSocket events for real-time updates
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type) {
        setActivities((prev) => [
          {
            id: Date.now(),
            type: detail.type,
            message: JSON.stringify(detail.payload).slice(0, 100),
            agent_id: null,
            created_at: new Date().toISOString(),
          },
          ...prev.slice(0, 19), // Keep last 20
        ]);
      }
    };
    window.addEventListener("nova:refresh", handler);
    return () => window.removeEventListener("nova:refresh", handler);
  }, []);

  if (activities.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        Real-time activity will appear here when agents run tasks.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {activities.map((a) => (
        <div key={a.id} className="flex items-start gap-2 text-xs">
          <span>{TYPE_ICONS[a.type] ?? "\u2022"}</span>
          <div className="min-w-0">
            <span className="text-gray-700">{a.message}</span>
            <span className="text-gray-300 ml-2">
              {new Date(a.created_at).toLocaleTimeString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
