import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

interface Task {
  status: string;
  verification_id?: string | null;
}

interface ProjectStatsProps {
  tasks: Task[];
  projectId?: string;
}

export function ProjectStats({ tasks, projectId }: ProjectStatsProps) {
  const { t } = useTranslation();
  // baseCost: loaded from REST API (historical sessions)
  const [baseCostUsd, setBaseCostUsd] = useState(0);
  const [baseTokens, setBaseTokens] = useState(0);
  // deltaCost: accumulated from live WebSocket usage events
  const [deltaCostUsd, setDeltaCostUsd] = useState(0);
  const [deltaTokens, setDeltaTokens] = useState(0);

  // Track which project's base cost is already loaded to avoid double-counting
  const loadedProjectRef = useRef<string | null>(null);

  // Load historical cost from REST API when project changes
  useEffect(() => {
    if (!projectId) return;
    setDeltaCostUsd(0);
    setDeltaTokens(0);
    setBaseCostUsd(0);
    setBaseTokens(0);
    loadedProjectRef.current = projectId;

    api.projects.getCost(projectId).then((data) => {
      if (loadedProjectRef.current !== projectId) return;
      const totalCost = data.costs.reduce((sum, c) => sum + (c.totalCost ?? 0), 0);
      const totalTok = data.costs.reduce((sum, c) => sum + (c.totalTokens ?? 0), 0);
      setBaseCostUsd(totalCost);
      setBaseTokens(totalTok);
    }).catch(() => {
      // Non-fatal — REST cost unavailable, delta from WS still works
    });
  }, [projectId]);

  // Accumulate live usage events from WebSocket
  useEffect(() => {
    const handler = (e: Event) => {
      const payload = (e as CustomEvent<any>).detail;
      const u = payload.usage;
      setDeltaCostUsd((prev) => prev + (u?.totalCostUsd ?? payload.costUsd ?? 0));
      const tokens = u
        ? (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheCreationTokens ?? 0)
        : (payload.totalTokens ?? 0);
      setDeltaTokens((prev) => prev + tokens);
    };
    window.addEventListener("nova:task-usage", handler);
    return () => window.removeEventListener("nova:task-usage", handler);
  }, []);

  const totalCostUsd = baseCostUsd + deltaCostUsd;
  const totalTokens = baseTokens + deltaTokens;

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "done").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const verified = tasks.filter((t) => t.verification_id != null).length;

  const costLabel =
    totalCostUsd > 0 ? `$${totalCostUsd.toFixed(4)}` : t("noCostData");
  const tokenLabel =
    totalTokens > 0
      ? t("contextTokens", { count: (totalTokens / 1000).toFixed(1) })
      : t("noCostData");

  const stats = [
    {
      value: total,
      label: t("statTotalTasks"),
      color: "text-gray-700 dark:text-gray-200",
      labelColor: "text-gray-400 dark:text-gray-500",
    },
    {
      value: completed,
      label: t("statCompleted"),
      color: "text-green-600 dark:text-green-400",
      labelColor: "text-gray-400 dark:text-gray-500",
    },
    {
      value: inProgress,
      label: t("statInProgress"),
      color: "text-blue-600 dark:text-blue-400",
      labelColor: "text-gray-400 dark:text-gray-500",
    },
    {
      value: verified,
      label: t("statVerified"),
      color: "text-purple-600 dark:text-purple-400",
      labelColor: "text-gray-400 dark:text-gray-500",
    },
  ];

  return (
    <div className="flex items-center gap-6 py-3 px-4 bg-gray-50 dark:bg-[#25253d] border border-gray-200 dark:border-gray-700 rounded-lg mb-6">
      {stats.map((stat, index) => (
        <div key={stat.label} className="flex items-center gap-4">
          <div className="text-center">
            <span className={`text-lg font-bold ${stat.color}`}>{stat.value}</span>
            <p className={`text-[11px] leading-none mt-0.5 ${stat.labelColor}`}>{stat.label}</p>
          </div>
          {index < stats.length - 1 && (
            <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
          )}
        </div>
      ))}
      <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
      <div className="text-center">
        <span className="text-lg font-bold text-amber-600 dark:text-amber-400">{costLabel}</span>
        <p className="text-[11px] leading-none mt-0.5 text-gray-400 dark:text-gray-500">{t("totalCost")}</p>
      </div>
      <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
      <div className="text-center">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{tokenLabel}</span>
        <p className="text-[11px] leading-none mt-0.5 text-gray-400 dark:text-gray-500">{t("totalTokens")}</p>
      </div>
    </div>
  );
}
