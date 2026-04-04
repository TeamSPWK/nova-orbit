import { defineConfig } from "tsup";

export default defineConfig([
  // Server + bin entry points
  {
    entry: {
      "bin/nova-orbit": "bin/nova-orbit.ts",
      "server/index": "server/index.ts",
    },
    outDir: "dist",
    format: "esm",
    target: "node20",
    platform: "node",
    splitting: true,
    clean: true,
    sourcemap: true,
    external: ["better-sqlite3"],
    banner: {
      // bin needs shebang
      js: "",
    },
    esbuildOptions(options) {
      options.banner = {
        js: '// Nova Orbit — AI Team Orchestration + Quality Gate',
      };
    },
  },
]);
