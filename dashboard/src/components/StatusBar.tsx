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
  const [novaRules, setNovaRules] = useState<NovaRulesVersion | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/claude-status", {
        headers: { Authorization: `Bearer ${getApiKey() ?? ""}` },
      });
      if (res.ok) {
        setStatus(await res.json());
      }
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

  if (!status || status.error || !status.raw) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400" />
        <span>{t("claudeStatusUnavailable")}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 text-[10px] text-gray-400 dark:text-gray-500 font-mono">
      <span className="text-gray-500 dark:text-gray-400 font-sans font-medium text-[10px] truncate max-w-[120px]">
        {status.model ?? "Claude"}
      </span>

      {(status.inputTokensK != null || status.outputTokensK != null) && (
        <>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span className="tabular-nums">
            {"\u2191"}{status.inputTokensK ?? 0}K {"\u2193"}{status.outputTokensK ?? 0}K
          </span>
        </>
      )}

      {status.costUsd != null && (
        <>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span className="text-amber-500 dark:text-amber-400 tabular-nums">
            ${status.costUsd.toFixed(2)}
          </span>
        </>
      )}

      {status.ratePercent != null && (
        <>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span className="flex items-center gap-1" title="터미널 Claude Code 세션의 5시간 사용량 한도 (Nova 에이전트 세션과 별개)">
            <span className="text-gray-500 dark:text-gray-500 text-[9px]">5h</span>
            <Gauge percent={status.ratePercent} segments={5} />
          </span>
        </>
      )}

      {status.updatedAt && (
        <span className="text-gray-500 dark:text-gray-600 text-[9px]" title={`Last updated: ${status.updatedAt}`}>
          {"\u2022"}
        </span>
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
