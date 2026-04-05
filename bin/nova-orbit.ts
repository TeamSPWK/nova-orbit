import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";

const DEFAULT_PORT = 7200;

async function main() {
  const args = process.argv.slice(2);
  const port = parseInt(
    args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? `${DEFAULT_PORT}`,
    10,
  );
  const noOpen = args.includes("--no-open");

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

  const url = `http://localhost:${port}`;
  console.log(`
  Dashboard: ${url}
  Press Ctrl+C to stop.
  `);

  if (!noOpen) {
    if (process.platform === "darwin") exec(`open ${url}`);
    else if (process.platform === "linux") exec(`xdg-open ${url}`);
    else if (process.platform === "win32") exec(`start ${url}`);
  }
}

main().catch((err) => {
  console.error("Failed to start Nova Orbit:", err);
  process.exit(1);
});
