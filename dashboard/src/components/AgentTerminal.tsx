import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { wsSend } from "../hooks/useWebSocket";

interface AgentOutputEvent extends CustomEvent {
  detail: { agentId: string; output: string };
}

interface AgentTerminalProps {
  agentId: string;
}

function parseStreamLine(raw: string): string | null {
  // Try to parse stream-json lines and extract readable text
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      // Assistant text blocks
      if (parsed.type === "assistant" && parsed.message?.content) {
        const texts = parsed.message.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text);
        if (texts.length > 0) return texts.join("");
      }
      // Result text
      if (parsed.type === "result" && parsed.result) {
        return parsed.result;
      }
      // Tool use (show name only)
      if (parsed.type === "tool_use" || parsed.subtype === "tool_use") {
        const name = parsed.name ?? parsed.tool_name ?? "";
        return name ? `[tool] ${name}` : null;
      }
      return null; // Skip system, tool_result, etc.
    } catch {
      // Not JSON — show as-is
      return trimmed || null;
    }
  }
  return null;
}

export function AgentTerminal({ agentId }: AgentTerminalProps) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<string[]>([]);

  // Subscribe to agent output via WebSocket
  useEffect(() => {
    wsSend({ type: "subscribe:agent", agentId });
    return () => {
      wsSend({ type: "unsubscribe:agent", agentId });
    };
  }, [agentId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { agentId: id, output } = (e as AgentOutputEvent).detail;
      if (id !== agentId) return;
      const parsed = parseStreamLine(output);
      if (parsed) setLines((prev) => [...prev, parsed]);
    };

    window.addEventListener("nova:agent-output", handler);
    return () => window.removeEventListener("nova:agent-output", handler);
  }, [agentId]);

  // Reset output when the target agent changes
  useEffect(() => {
    setLines([]);
  }, [agentId]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll within container only (not the page)
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium">
          {t("terminalTitle")}
        </h3>
        {lines.length > 0 && (
          <button
            onClick={() => setLines([])}
            className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {t("terminalClear")}
          </button>
        )}
      </div>

      <div
        className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
        style={{ background: "#0d1117" }}
      >
        <div
          ref={containerRef}
          className="overflow-y-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed"
          style={{ maxHeight: "260px", color: "#39d353" }}
        >
          {lines.length === 0 ? (
            <span style={{ color: "#4b5563" }}>{t("terminalWaiting")}</span>
          ) : (
            lines.map((line, i) => (
              <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
