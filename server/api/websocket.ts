import type { WebSocketServer, WebSocket } from "ws";

export function createWSHandler(wss: WebSocketServer): void {
  // Prevent server crash on WebSocket errors
  wss.on("error", (err) => {
    console.error("[WS Server] Error:", err.message);
  });

  wss.on("connection", (ws: WebSocket) => {
    // Handle client errors gracefully
    ws.on("error", (err) => {
      console.error("[WS Client] Error:", err.message);
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "subscribe" && msg.projectId) {
          (ws as any).__projectId = msg.projectId;
        }

        if (msg.type === "subscribe:agent" && msg.agentId) {
          if (!(ws as any).__agentIds) (ws as any).__agentIds = new Set();
          (ws as any).__agentIds.add(msg.agentId);
        }

        if (msg.type === "unsubscribe:agent" && msg.agentId) {
          (ws as any).__agentIds?.delete(msg.agentId);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    try {
      ws.send(JSON.stringify({
        type: "connected",
        payload: { message: "Nova Orbit WebSocket connected" },
        timestamp: new Date().toISOString(),
      }));
    } catch {
      // Client may have disconnected immediately
    }
  });
}

/**
 * Safe broadcast — skip clients that are not ready.
 */
export function broadcastAgentOutput(
  wss: WebSocketServer,
  agentId: string,
  output: string,
): void {
  const message = JSON.stringify({
    type: "agent:output",
    payload: { agentId, output },
    timestamp: new Date().toISOString(),
  });

  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    try {
      const ids = (client as any).__agentIds as Set<string> | undefined;
      if (ids?.has(agentId)) {
        client.send(message);
      }
    } catch {
      // Skip failed clients
    }
  }
}
