# Nova Orbit

AI Team Orchestration + Quality Gate for Solo Founders.
Claude Code sessions as agents, goal-based orchestration, Nova Quality Gate verification.

## Language

- Claude는 사용자에게 항상 **한국어**로 응답한다.

## Build & Run

```bash
# Development
npm run dev:server          # tsx watch server
npm run dev:dashboard       # vite dev (port 5173, proxy → 7200)

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
templates/agents/     → YAML role presets (9개: cto, pm, backend, frontend, ux, qa, reviewer, devops, marketer)
```

## Key Design Decisions

- **SQLite** (not Postgres) — zero config, single file, npx-friendly
- **Claude Code CLI subprocess** — Paperclip's claude_local pattern (stdin/stdout, --add-dir, session resume)
- **Generator-Evaluator separation** — implementation and verification are ALWAYS different sessions
- **stream-json output** — `--output-format stream-json` for structured response parsing

## Smart Team Suggestion

에이전트 팀 구성은 3-layer 우선순위:

1. **`.claude/agents/*.md`** — 프로젝트 소유자가 정의한 에이전트. 파일 = 에이전트. 최우선.
2. **`CLAUDE.md`** — 각 에이전트 시스템 프롬프트 앞에 프로젝트 컨텍스트로 주입.
3. **`package.json`** — `.claude/agents/`가 없을 때만 tech stack fallback.

## Agent Preset Structure

`templates/agents/*.yaml` 프리셋은 다음 구조를 따른다:

```yaml
name: Agent Name
role: role_id
description: "한줄 설명"
order: 1  # UI 정렬 순서
systemPrompt: |
  # Role — 역할 정의
  # Responsibilities — 핵심 책임
  # Constraints — 하지 말 것
  # Output Format — 출력 형식 (해당 시)
  # Collaboration — 다른 에이전트와의 관계
```

## Claude Status Integration

대시보드 상단 StatusBar는 `~/.claude/tmux-status` 파일을 10초 폴링하여 표시:
- Context window %, 토큰 사용량, 비용($), 5h rate limit %

## Git Convention

```
feat: new feature      | fix: bug fix
update: enhancement    | docs: documentation
refactor: refactoring  | chore: config/misc
```

## Credentials

- **Never commit**: `.env`, `.nova-orbit/`, `*.db`
