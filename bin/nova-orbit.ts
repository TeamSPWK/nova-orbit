#!/usr/bin/env node

import { resolve } from "node:path";
import { existsSync } from "node:fs";

const DEFAULT_PORT = 3000;

async function main() {
  const args = process.argv.slice(2);
  const port = parseInt(
    args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? `${DEFAULT_PORT}`,
    10,
  );

  console.log(`
  ╔══════════════════════════════════════════╗
  ║          Nova Orbit v0.1.0              ║
  ║   AI Team Orchestration + Quality Gate  ║
  ╚══════════════════════════════════════════╝
  `);

  // Ensure data directory exists
  const dataDir = resolve(process.cwd(), ".nova-orbit");
  if (!existsSync(dataDir)) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
    console.log(`  Created data directory: ${dataDir}`);
  }

  // Start server
  const { startServer } = await import("../server/index.js");
  await startServer({ port, dataDir });

  console.log(`
  Dashboard: http://localhost:${port}
  Press Ctrl+C to stop.
  `);
}

main().catch((err) => {
  console.error("Failed to start Nova Orbit:", err);
  process.exit(1);
});
