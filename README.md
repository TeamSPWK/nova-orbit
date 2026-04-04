# Nova Orbit

> AI Team Orchestration + Quality Gate for Solo Founders

"Build like a team, even when you're alone." — Orchestrate Claude Code sessions as AI agents, decompose goals into tasks, and verify every output with Nova Quality Gate.

## Quick Start

```bash
npx nova-orbit
```

Opens `http://localhost:3000` with a dashboard to manage your AI team.

## What is Nova Orbit?

Nova Orbit turns your Claude Code CLI sessions into a team of specialized AI agents:

- **Coder** — Implements features, writes production-ready code
- **Reviewer** — Reviews code with adversarial mindset, runs Quality Gate
- **Marketer** — Creates landing pages, blog posts, SEO content
- **Designer** — UI/UX design, wireframes, prototypes

### Core Differentiator: Quality Gate

Every output is independently verified using Nova's Generator-Evaluator separation:

1. **Generator** (Coder) implements the task
2. **Evaluator** (Reviewer) verifies independently — no shared context
3. **5-Dimension Verification**: Functionality, Data Flow, Design Alignment, Craft, Edge Cases
4. Results: PASS / CONDITIONAL / FAIL with severity classification

### Key Features

- `npx` one-line install — SQLite embedded, zero config
- Dashboard to visualize agent progress, tasks, and verification logs
- Goal decomposition — describe what you want, agents figure out the tasks
- Real-time WebSocket streaming of agent output
- Built on Claude Code CLI — uses your existing Claude Pro/Team subscription

## Development

```bash
# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Run dev servers (server + dashboard)
npm run dev

# Type check
npm run typecheck

# Build for production
npm run build
```

## Architecture

```
nova-orbit/
├── bin/              # CLI entry point (npx nova-orbit)
├── server/           # Node.js backend
│   ├── api/          # REST routes + WebSocket
│   ├── core/
│   │   ├── agent/    # Claude Code session management
│   │   ├── orchestration/  # Goal → Task pipeline
│   │   ├── project/  # Project CRUD
│   │   └── quality-gate/   # Nova verification engine
│   └── db/           # SQLite schema
├── dashboard/        # React + TailwindCSS frontend
├── shared/           # TypeScript type definitions
└── templates/        # Agent role presets (YAML)
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React, TailwindCSS, Zustand |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite (better-sqlite3) |
| Real-time | WebSocket (ws) |
| AI Runtime | Claude Code CLI (subprocess) |

## License

MIT

## Attribution

Inspired by [Paperclip](https://github.com/paperclipai/paperclip) (MIT License).
Built on [Nova](https://github.com/TeamSPWK/nova) Quality Gate engine.
