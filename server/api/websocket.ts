import type { WebSocketServer, WebSocket } from "ws";

export function createWSHandler(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Client can subscribe to specific project events
        if (msg.type === "subscribe" && msg.projectId) {
          (ws as any).__projectId = msg.projectId;
        }

        // Client can subscribe to agent output stream
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

    ws.send(JSON.stringify({
      type: "connected",
      payload: { message: "Nova Orbit WebSocket connected" },
      timestamp: new Date().toISOString(),
    }));
  });
}

/**
 * Send agent output to subscribed WebSocket clients.
 * This is called from the session manager when an agent produces output.
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
    const ids = (client as any).__agentIds as Set<string> | undefined;
    if (ids?.has(agentId)) {
      client.send(message);
    }
  }
}
