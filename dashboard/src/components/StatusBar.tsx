import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getApiKey } from "../lib/api";

interface ClaudeStatus {
  raw: string | null;
  model: string | null;
  inputTokensK: number | null;
  outputTokensK: number | null;
  costUsd: number | null;
  ratePercent: number | null;
  updatedAt: string | null;
  error?: string;
}

interface OrbitStatus {
  activeSessions: number;
  activeAgents: number;
  totalTokens: number;
  totalCost: number;
  todayTokens: number;
  todayCost: number;
  todaySessions: number;
}

interface NovaRulesVersion {
  synced: boolean;
  novaVersion: string | null;
  novaCommit: string | null;
  syncedAt: string | null;
  latestVersion: string | null;
  latestCommit: string | null;
  needsUpdate: boolean;
}

/** 7-segment gauge bar like CLI "██░░░░░ 6%" */
function Gauge({ percent, segments = 7 }: { percent: number; segments?: number }) {
  const filled = Math.round((percent / 100) * segments);
  const color =
    percent < 50
      ? "text-green-500"
      : percent < 80
        ? "text-yellow-500"
        : "text-red-500";
  const dot =
    percent < 50
      ? "bg-green-500"
      : percent < 80
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot} shrink-0`} />
      <span className="font-mono tracking-tight text-[9px] leading-none">
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className={i < filled ? color : "text-gray-600 dark:text-gray-700"}
          >
            {i < filled ? "\u2588" : "\u2591"}
          </span>
        ))}
      </span>
      <span className={`${color} tabular-nums`}>{percent}%</span>
    </span>
  );
}

export function StatusBar() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [orbit, setOrbit] = useState<OrbitStatus | null>(null);
  const [novaRules, setNovaRules] = useState<NovaRulesVersion | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const [claudeRes, orbitRes] = await Promise.all([
        fetch("/api/claude-status", { headers: { Authorization: `Bearer ${getApiKey() ?? ""}` } }),
        fetch("/api/orbit-status", { headers: { Authorization: `Bearer ${getApiKey() ?? ""}` } }),
      ]);
      if (claudeRes.ok) setStatus(await claudeRes.json());
      if (orbitRes.ok) setOrbit(await orbitRes.json());
    } catch {
      // silent — server may not have statusline
    }
  }, []);

  const fetchNovaVersion = useCallback(async () => {
    try {
      const res = await fetch("/api/nova-rules/version", {
        headers: { Authorization: `Bearer ${getApiKey() ?? ""}` },
      });
      if (res.ok) {
        setNovaRules(await res.json());
      }
    } catch { /* silent */ }
  }, []);

  const syncNovaRules = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/nova-rules/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${getApiKey() ?? ""}` },
      });
      if (res.ok) {
        await fetchNovaVersion();
      }
    } catch { /* silent */ }
    setSyncing(false);
  }, [fetchNovaVersion]);

  // Poll every 10s + on mount
  useEffect(() => {
    fetchStatus();
    fetchNovaVersion();
    const timer = setInterval(fetchStatus, 10_000);
    const novaTimer = setInterval(fetchNovaVersion, 60_000); // check Nova every 60s
    return () => { clearInterval(timer); clearInterval(novaTimer); };
  }, [fetchStatus, fetchNovaVersion]);

  // Also refresh on agent activity
  useEffect(() => {
    const handler = () => { fetchStatus(); };
    window.addEventListener("nova:prompt-complete", handler);
    window.addEventListener("nova:task-usage", handler);
    return () => {
      window.removeEventListener("nova:prompt-complete", handler);
      window.removeEventListener("nova:task-usage", handler);
    };
  }, [fetchStatus]);

  const hasClaudeStatus = status && !status.error && status.raw;

  return (
    <div className="flex items-center gap-2.5 text-[10px] text-gray-400 dark:text-gray-500 font-mono">
      {/* Nova Orbit agent stats — always available */}
      {orbit && (
        <>
          {orbit.activeAgents > 0 && (
            <span className="flex items-center gap-1" title={t("orbitActiveAgents")}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-green-600 dark:text-green-400">{orbit.activeAgents}</span>
            </span>
          )}
          {orbit.todayCost > 0 && (
            <>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="text-amber-500 dark:text-amber-400 tabular-nums" title={t("orbitTodayCost", { total: orbit.totalCost.toFixed(2) })}>
                {t("today")} ${orbit.todayCost.toFixed(2)}
              </span>
            </>
          )}
          {orbit.todayTokens > 0 && (
            <>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="tabular-nums" title={t("orbitTotalTokens", { total: Math.round(orbit.totalTokens / 1000) })}>
                {Math.round(orbit.todayTokens / 1000)}K
              </span>
            </>
          )}
        </>
      )}

      {/* Terminal Claude session — optional */}
      {hasClaudeStatus && status!.ratePercent != null && (
        <>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span className="flex items-center gap-1" title={t("terminalRateLimit")}>
            <span className="text-gray-500 dark:text-gray-500 text-[9px]">5h</span>
            <Gauge percent={status!.ratePercent!} segments={5} />
          </span>
        </>
      )}

      {novaRules?.synced && (
        <>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span
            className={`flex items-center gap-1 ${novaRules.needsUpdate ? "text-amber-500" : "text-gray-500 dark:text-gray-500"}`}
            title={`Nova Rules: v${novaRules.novaVersion ?? "?"} (${novaRules.novaCommit})${novaRules.needsUpdate ? `\nLatest: v${novaRules.latestVersion ?? novaRules.latestCommit}` : ""}\nSynced: ${novaRules.syncedAt}`}
          >
            <span className="text-[9px]">Nova</span>
            <span className="tabular-nums">v{novaRules.novaVersion ?? novaRules.novaCommit?.slice(0, 7)}</span>
            {novaRules.needsUpdate && (
              <button
                onClick={syncNovaRules}
                disabled={syncing}
                className="text-[9px] px-1 py-0 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 disabled:opacity-50 transition-colors"
                title="Sync Nova rules to latest"
              >
                {syncing ? "..." : "sync"}
              </button>
            )}
          </span>
        </>
      )}
    </div>
  );
}
