import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
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
  // SQLite datetime('now') returns UTC without 'Z' suffix — append it
  const normalized = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  return new Date(normalized).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatWsMessage(
  type: string,
  payload: unknown,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, string>;

  switch (type) {
    case "agent:status": {
      const statusLabel = t(`agentStatus_${p.status}`) || p.status || "";
      return t("activityAgentStatus", { name: p.name ?? t("agentUnnamed"), status: statusLabel });
    }
    case "task:updated":
      return t("activityTaskUpdated", { title: p.title ?? "", status: p.status ?? "" });
    case "task:started":
      return t("activityTaskStarted", { title: p.title ?? "" });
    case "task:completed":
      return t("activityTaskCompleted", { title: p.title ?? "" });
    case "verification:result": {
      const rawVerdict = p.verdict ?? (p.passed === "true" ? "pass" : p.passed === "false" ? "fail" : "");
      const verdictLabel = t(`verdict_${rawVerdict}`) || rawVerdict;
      return t("activityVerification", { verdict: verdictLabel });
    }
    case "project:updated":
      return t("activityProjectUpdated");
    default:
      return t("activityUnknown", { type });
  }
}

export function ActivityFeed({ projectId }: ActivityFeedProps) {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const wsIdRef = useRef(0);
  const buildWsActivity = useCallback(
    (detail: { type: string; payload?: unknown }): Activity => ({
      id: -(++wsIdRef.current),
      type: detail.type,
      message: formatWsMessage(detail.type, detail.payload, t),
      agent_id: (detail.payload as Record<string, string> | null)?.agent_id ?? null,
      created_at: new Date().toISOString(),
    }),
    [t],
  );

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
      setActivities((prev) => [buildWsActivity(detail), ...prev].slice(0, 50));
    };

    window.addEventListener("nova:refresh", handler);
    return () => window.removeEventListener("nova:refresh", handler);
  }, [buildWsActivity]);

  if (loading) {
    return <p className="text-xs text-gray-400 italic">{t("loadingActivity")}</p>;
  }

  if (activities.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        {t("noActivity")}
      </p>
    );
  }

  return (
    <div className="space-y-1.5 px-3 py-2">
      {activities.map((a) => (
        <div key={a.id} className="flex items-start gap-2 text-xs">
          <span className="shrink-0 w-4 text-center">
            {TYPE_ICONS[a.type] ?? "•"}
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-gray-700 dark:text-gray-300 break-words">{a.message}</span>
          </div>
          <span className="shrink-0 text-gray-300 dark:text-gray-600 tabular-nums">
            {formatTime(a.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
