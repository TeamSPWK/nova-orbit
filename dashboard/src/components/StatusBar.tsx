import { useEffect, useState, useCallback } from "react";
import { getApiKey } from "../lib/api";

interface ClaudeStatus {
  raw: string | null;
  model: string | null;
  contextPercent: number | null;
  inputTokensK: number | null;
  outputTokensK: number | null;
  costUsd: number | null;
  ratePercent: number | null;
  updatedAt: string | null;
  error?: string;
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
  const [status, setStatus] = useState<ClaudeStatus | null>(null);

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

  // Poll every 10s + on mount
  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 10_000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

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
        <span>Claude status unavailable</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 text-[10px] text-gray-400 dark:text-gray-500 font-mono">
      <span className="text-gray-500 dark:text-gray-400 font-sans font-medium text-[10px] truncate max-w-[120px]">
        {status.model ?? "Claude"}
      </span>

      {status.contextPercent != null && (
        <>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span className="flex items-center gap-1" title="Context window usage">
            <span className="text-gray-500 dark:text-gray-500 text-[9px]">ctx</span>
            <Gauge percent={status.contextPercent} segments={5} />
          </span>
        </>
      )}

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
          <span className="flex items-center gap-1" title="5-hour rate limit usage">
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
    </div>
  );
}
