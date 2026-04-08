import type { IncomingMessage } from "node:http";
import type { WebSocketServer, WebSocket } from "ws";

export function createWSHandler(wss: WebSocketServer, apiKey: string): void {
  // Prevent server crash on WebSocket errors
  wss.on("error", (err) => {
    console.error("[WS Server] Error:", err.message);
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // 인증 확인 — close()는 proxy EPIPE 가능성이 있어 유예 close 사용
    // 미인증 연결은 subscribe/broadcast 모두 차단되고 10초 후 close
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    const authed = token === apiKey;
    (ws as any).__authenticated = authed;

    // Handle client errors gracefully
    ws.on("error", (err) => {
      console.error("[WS Client] Error:", err.message);
    });

    if (!authed) {
      // Delayed close lets proxies finish their handshake cleanly
      try { ws.send(JSON.stringify({ type: "error", payload: { code: "unauthorized" } })); } catch { /* ignore */ }
      const closeTimer = setTimeout(() => {
        try { ws.close(4001, "Unauthorized"); } catch { /* already closed */ }
      }, 10_000);
      ws.on("close", () => clearTimeout(closeTimer));
      return; // Do NOT register message handler — reject subscriptions outright
    }

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
 * Broadcast token usage and cost for a completed task.
 */
export function broadcastTaskUsage(
  wss: WebSocketServer,
  payload: { taskId: string; agentId: string; totalTokens: number; costUsd: number },
): void {
  const message = JSON.stringify({
    type: "task:usage",
    payload,
    timestamp: new Date().toISOString(),
  });

  for (const client of wss.clients) {
    if (client.readyState !== 1 || !(client as any).__authenticated) continue;
    try {
      client.send(message);
    } catch {
      // Skip failed clients
    }
  }
}

/**
 * Safe broadcast — skip clients that are not ready or not authenticated.
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
    if (client.readyState !== 1 || !(client as any).__authenticated) continue;
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
