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
