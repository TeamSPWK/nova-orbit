# Nova Orbit

AI Team Orchestration + Quality Gate for Solo Founders.
Claude Code sessions as agents, goal-based orchestration, Nova Quality Gate verification.

## Language

- Claude는 사용자에게 항상 **한국어**로 응답한다.

## Build & Run

```bash
# Development
npm run dev:server          # tsx watch server
npm run dev:dashboard       # vite dev (port 5173, proxy → 3000)

# Production build
npm run build               # server (tsup) + dashboard (vite)
node dist/bin/nova-orbit.js # start built server

# Type check
npm run typecheck           # server
cd dashboard && npx tsc --noEmit  # dashboard
```

## Architecture

```
bin/nova-orbit.ts     → CLI entry point (npx nova-orbit)
server/
  index.ts            → Express + WebSocket server
  db/schema.ts        → SQLite schema (7 tables, better-sqlite3)
  api/routes/         → REST API (projects, agents, goals, tasks, verification, orchestration, activities)
  core/
    agent/adapters/   → Claude Code CLI adapter (Paperclip pattern: stdin, stream-json, --add-dir)
    agent/session.ts  → Session manager (spawn/kill/resume)
    agent/roles.ts    → YAML template loader
    orchestration/    → Goal → Task decomposition, execution pipeline
    project/          → Import, GitHub connect, tech stack analyzer
    quality-gate/     → Nova 5-dimension verification (Generator-Evaluator separation)
shared/types.ts       → Shared TypeScript types
dashboard/            → React + TailwindCSS + Zustand
templates/agents/     → YAML role presets (coder, reviewer, qa, marketer, designer)
```

## Key Design Decisions

- **SQLite** (not Postgres) — zero config, single file, npx-friendly
- **Claude Code CLI subprocess** — Paperclip's claude_local pattern (stdin/stdout, --add-dir, session resume)
- **Generator-Evaluator separation** — implementation and verification are ALWAYS different sessions
- **stream-json output** — `--output-format stream-json` for structured response parsing

## Git Convention

```
feat: new feature      | fix: bug fix
update: enhancement    | docs: documentation
refactor: refactoring  | chore: config/misc
```

## Credentials

- **Never commit**: `.env`, `.nova-orbit/`, `*.db`
