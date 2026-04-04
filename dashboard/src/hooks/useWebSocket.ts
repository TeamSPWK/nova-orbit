import { useEffect, useRef } from "react";
import { useStore } from "../stores/useStore";

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { setConnected, updateTask } = useStore();

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    function connect() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "task:updated":
              updateTask(msg.payload);
              break;
            case "agent:status":
            case "verification:result":
            case "project:updated":
              // Trigger a refetch — handled by components
              window.dispatchEvent(new CustomEvent("nova:refresh", { detail: msg }));
              break;
          }
        } catch {
          // Ignore
        }
      };

      ws.onclose = () => {
        setConnected(false);
        // Reconnect after 3s
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [setConnected, updateTask]);
}
