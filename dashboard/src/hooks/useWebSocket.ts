import { useEffect, useRef } from "react";
import { useStore } from "../stores/useStore";
import { getApiKey } from "../lib/api";

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      // API 키가 없으면 연결 지연 — initAuth() 완료 대기
      const token = getApiKey();
      if (!token) {
        if (!destroyed) reconnectTimer = setTimeout(connect, 1000);
        return;
      }
      const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        useStore.getState().setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "task:updated":
              useStore.getState().updateTask(msg.payload);
              window.dispatchEvent(new CustomEvent("nova:task-updated-event", { detail: msg.payload }));
              break;
            case "task:started":
              window.dispatchEvent(new CustomEvent("nova:task-started", { detail: msg.payload }));
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "task:completed":
              window.dispatchEvent(new CustomEvent("nova:task-completed", { detail: msg.payload }));
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "verification:result":
              window.dispatchEvent(new CustomEvent("nova:verification-result", { detail: msg.payload }));
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "agent:output":
              // Still dispatch for AgentTerminal in agent detail view
              window.dispatchEvent(
                new CustomEvent("nova:agent-output", {
                  detail: { agentId: msg.payload.agentId, output: msg.payload.output },
                })
              );
              break;
            case "agent:prompt-complete":
              window.dispatchEvent(
                new CustomEvent("nova:prompt-complete", { detail: msg.payload })
              );
              // Also trigger refresh to sync agent status
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "multi-prompt:agent-done":
              window.dispatchEvent(
                new CustomEvent("nova:multi-agent-done", { detail: msg.payload })
              );
              // Refresh to sync agent status changes
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "multi-prompt:complete":
              window.dispatchEvent(
                new CustomEvent("nova:multi-complete", { detail: msg.payload })
              );
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "task:usage":
              window.dispatchEvent(
                new CustomEvent("nova:task-usage", { detail: msg.payload })
              );
              break;
            case "system:rate-limit":
              window.dispatchEvent(new CustomEvent("nova:rate-limit", { detail: msg.payload }));
              // Also trigger refresh
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "task:delegated":
              window.dispatchEvent(new CustomEvent("nova:task-delegated", { detail: msg.payload }));
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "queue:paused":
              window.dispatchEvent(new CustomEvent("nova:queue-paused", { detail: msg.payload }));
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "queue:resumed":
              window.dispatchEvent(new CustomEvent("nova:queue-resumed", { detail: msg.payload }));
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "queue:stopped":
              window.dispatchEvent(new CustomEvent("nova:queue-stopped", { detail: msg.payload }));
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "autopilot:mode-changed":
              window.dispatchEvent(new CustomEvent("nova:autopilot-changed", { detail: msg.payload }));
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "autopilot:full-completed":
              window.dispatchEvent(new CustomEvent("nova:autopilot-full-completed", { detail: msg.payload }));
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "agent:status":
            case "project:updated":
              // Trigger a refetch — handled by components
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
            case "system:error":
              window.dispatchEvent(new CustomEvent("nova:system-error", { detail: msg.payload }));
              break;
            case "task:git":
              window.dispatchEvent(new CustomEvent("nova:task-git", { detail: msg.payload }));
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
          }
        } catch {
          // Ignore
        }
      };

      ws.onclose = () => {
        useStore.getState().setConnected(false);
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);
}
