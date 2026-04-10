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

## Dashboard UI Rules

- **`window.confirm` / `window.alert` / `window.prompt` 사용 금지** — 항상 프로젝트 내 컴포넌트 사용
  - 확인 다이얼로그: `ConfirmDialog` (`dashboard/src/components/ConfirmDialog.tsx`)
  - 텍스트 입력: `InputDialog` (`dashboard/src/components/InputDialog.tsx`)
  - 알림: `Toast` (`dashboard/src/components/Toast.tsx`)

## UX 원칙 — 비개발자 친화

Nova Orbit은 **개발자 + 비개발자(PM, 파운더 등) 모두**를 위한 도구다. UI 문자열 작성 시 반드시 아래 규칙을 따른다:

- **개발 전문 용어 직접 노출 금지** — 아래 매핑표의 대체 용어를 사용할 것
  | 금지 용어 | EN 대체 | KO 대체 |
  |-----------|---------|---------|
  | Decompose | Split into Tasks | 작업 분할 |
  | System Prompt | Role Instructions | 역할 지시사항 |
  | Spec | Blueprint | 기획서 |
  | Preset | Template | 템플릿 |
  | Queue | Auto-run | 자동 실행 |
  | Rate Limit | Usage Limit | 사용량 한도 |
  | Working Directory | Project Folder | 프로젝트 폴더 |
  | Kill Session | End Session | 에이전트 종료 |
  | Worktree | Isolated workspace | 독립된 작업 공간 |
  | Branch/Merge (사용자 노출) | Save/Apply | 저장/반영 |
- **Session ID, UUID 등 내부 식별자**는 기본 숨김 또는 "Agent ID"로 표기
- **Autopilot 모드명**: Manual→수동, Semi-Auto→반자동, Full Auto→완전 자동
- 새 UI 문자열 추가 시 "비개발자가 이해할 수 있는가?" 자문할 것

## Nova Engineering 필수 체크포인트

이 프로젝트는 Nova Engineering을 사용한다. **AI는 아래 시점에서 반드시 해당 커맨드를 실행해야 한다.**

### 커밋 전 (필수)
- `npm run typecheck` + `cd dashboard && npx tsc --noEmit` — 둘 다 PASS 필수
- 3파일 이상 변경 시: 커밋 전 변경 요약을 사용자에게 제시

### 사이드이펙트 체크 (필수)
- UI 버튼/상태 변경 시: **같은 영역의 모든 인터랙션 요소**(버튼, 드롭다운, 입력 등)를 스캔하고 영향받는 것 나열
- "이 변경이 영향을 주는 다른 요소: [목록]" 형태로 사용자에게 보고 후 구현

### 동일 영역 재수정 감지
- 같은 파일/기능을 2회 이상 수정하게 되면: 근본 원인 분석을 먼저 수행
- "이 영역을 다시 수정합니다. 근본 원인을 먼저 분석할까요?" 사용자에게 확인

### 세션 마무리 (필수)
- NOVA-STATE.md 갱신 — 사용자가 요청하기 전에 AI가 먼저 제안
- 커밋 수, 주요 변경, Known Gaps 업데이트

## Known Mistakes

- **JSX 삼항 3단+ 중첩**: 괄호 불일치 발생 빈번. 3단 이상은 IIFE `(() => { ... })()` 또는 별도 함수로 추출할 것
- **DB 직접 수정**: broadcast가 안 나가서 대시보드 미반영. 항상 API 경유 (`API_KEY=$(cat .nova-orbit/api-key)`)
- **spawn 전 emit**: session.process가 null인 상태에서 이벤트 emit하면 리스너가 데이터를 못 잡음. spawn 후 즉시 별도 이벤트로 전달

## Credentials

- **Never commit**: `.env`, `.nova-orbit/`, `*.db`
