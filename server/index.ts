import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { resolve } from "node:path";
import { createDatabase, migrate } from "./db/schema.js";
import { createProjectRoutes } from "./api/routes/projects.js";
import { createAgentRoutes } from "./api/routes/agents.js";
import { createTaskRoutes } from "./api/routes/tasks.js";
import { createVerificationRoutes } from "./api/routes/verification.js";
import { createGoalRoutes } from "./api/routes/goals.js";
import { createWSHandler } from "./api/websocket.js";
import type { Database } from "better-sqlite3";

export interface ServerConfig {
  port: number;
  dataDir: string;
}

export interface AppContext {
  db: Database;
  wss: WebSocketServer;
  broadcast: (event: string, data: unknown) => void;
}

export async function startServer(config: ServerConfig): Promise<void> {
  const { port, dataDir } = config;

  // Ensure data directory exists
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dataDir, { recursive: true });

  // Initialize database
  const dbPath = resolve(dataDir, "nova-orbit.db");
  const db = createDatabase(dbPath);
  migrate(db);
  console.log(`  Database: ${dbPath}`);

  // Express app
  const app = express();
  app.use(express.json());

  // CORS for dashboard dev server
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // HTTP + WebSocket server
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  const broadcast = (event: string, data: unknown) => {
    const message = JSON.stringify({ type: event, payload: data, timestamp: new Date().toISOString() });
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  };

  const ctx: AppContext = { db, wss, broadcast };

  // WebSocket handler
  createWSHandler(wss);

  // API routes
  app.use("/api/projects", createProjectRoutes(ctx));
  app.use("/api/agents", createAgentRoutes(ctx));
  app.use("/api/goals", createGoalRoutes(ctx));
  app.use("/api/tasks", createTaskRoutes(ctx));
  app.use("/api/verifications", createVerificationRoutes(ctx));

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  // Serve dashboard (production)
  const dashboardDist = resolve(import.meta.dirname ?? __dirname, "../dashboard/dist");
  app.use(express.static(dashboardDist));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(resolve(dashboardDist, "index.html"));
  });

  server.listen(port, () => {
    console.log(`  Server listening on port ${port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n  Shutting down...");
    wss.close();
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
