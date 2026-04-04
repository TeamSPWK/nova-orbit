import { useEffect, useRef, useState } from "react";

interface UsagePayload {
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function StatusBar() {
  const [inputTokens, setInputTokens] = useState(0);
  const [outputTokens, setOutputTokens] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  // Accumulate token usage from WebSocket events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UsagePayload>).detail;
      if (!detail?.usage) return;
      setInputTokens((prev) => prev + (detail.usage.inputTokens ?? 0));
      setOutputTokens((prev) => prev + (detail.usage.outputTokens ?? 0));
    };
    window.addEventListener("nova:task-usage", handler);
    return () => window.removeEventListener("nova:task-usage", handler);
  }, []);

  // Tick elapsed time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const inputK = Math.round(inputTokens / 1000);
  const outputK = Math.round(outputTokens / 1000);

  return (
    <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500">
      <span className="flex items-center gap-1">
        <span>Opus 4.6 (1M)</span>
      </span>
      <span className="text-gray-300 dark:text-gray-600">|</span>
      <span>
        {"\u2191"}{inputK}K {"\u2193"}{outputK}K
      </span>
      <span className="text-gray-300 dark:text-gray-600">|</span>
      <span>{formatElapsed(elapsed)}</span>
    </div>
  );
}
