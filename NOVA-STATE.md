# Nova State

## Current
- **Goal**: Pulsar dogfooding 중 터진 architect-phase 무한 루프 + rate-limit false positive 수리
- **Phase**: done — 루프 차단, rate-limit 감지 엄격화, 단일 인스턴스 PID lock, architect 실패 DB 로깅, **stream-parser rate_limit_event status 분기** (병렬 세션 2건 추가 수리)
- **Blocker**: none. (이전에 "실제 quota 소진"으로 기록했던 진단은 파서 오분류가 섞여 있었을 가능성 — 아래 "Evidence Reinterpretation" 참조)

## Tasks (최신 세션)
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| P0 Silent failure gate (engine + errors.ts + 11 tests) | done | PASS | ECONNRESET/401/auth_error 패턴 — false-done 방지 |
| P1 Evaluator git diff 주입 + scope check | done | PASS | 잘못된 디렉토리 감지 |
| P2 tasks.target_files + stack_hint 스키마 + UI | done | PASS | DB 마이그레이션 + decomposer 규칙 + TaskDetail 표시 |
| P3 execution-verify 태스크 full scope 자동 승격 + 18 tests | done | PASS | "렌더링 검증" hallucination 방지 |
| P4 Entry Point Completeness (gated surface → Bootstrap task) + 26 tests | done | PASS | 인증 구현만 하고 로그인 경로 없는 갭 방지 |
| P5 API Contract Mismatch (풀스택 계약 검증) + 16 tests | done | PASS | SLA/Content crash 재발 방지 |
| Pulsar 전수 감사 + 계약 불일치 3종 수정 | done | PASS | /analytics, /content, /reliability 모두 정상 |
| Pulsar Dev bypass (PULSAR_DEV_MODE loopback) | done | PASS | 솔로 dev가 로그인 없이 대시보드 열림 |
| Pulsar Next.js 홈 + dev.sh + env 템플릿 | done | PASS | Layer 3 검증 (빌드+curl+playwright) |
| Decomposer truncation 3종 수정 (prompt 압축, recovery, race lock) + 10 tests | done | PASS | balanced-brace 파서로 regex 대체 |
| Autopilot PATCH → pending goal 자동 재스캔 | done | PASS | off→goal 전환 시 대기 중인 goal spec+decompose 재개 |
| Decompose/Architect current_activity UX | done | PASS | 에이전트 activity 스캔으로 goal card 실시간 표시 |
| Rate-limit 3회 → 15분 cooldown self-heal | done | PASS | 영구 정지 폐기, 자동 재개 + 카운터 리셋 |
| Rate-limit pause overlay (카운트다운 + "지금 재시도") | done | PASS | 기다리지 않고 즉시 탈출 가능 |
| version.json 거짓 dirty 방지 | done | PASS | sync-nova-rules.sh가 내용 변경 시만 덮어쓰기 |
| Architect phase 무한 루프 차단 (scheduler executeOne) | done | PASS | todo 상태 throw 시 blocked로 transition → loop 종결 |
| Adapter rate-limit 무한 재귀 제한 (1회) | done | PASS | runAttempt 재귀 폭발 방지, 결과는 scheduler 레벨 backoff로 위임 |
| isRateLimitError false positive 차단 | done | PASS | capacity/quota 단독 매칭 제거, 엄격한 시그니처만 |
| Architect phase silent failure DB 로깅 | done | PASS | `architect_failed` activity로 원인 가시화 (STREAM_ERROR 등) |
| Rate-limit stderr 원문 activity 보존 | done | PASS | `rate_limit_hit` 저장 — 진짜 429 vs 잡음 구분 가능 |
| 서버 단일 인스턴스 PID lock (.nova-orbit/server.pid) | done | PASS | 중복 concurrently 세션 방지, stale lock 자동 overwrite |
| `/api/goals/suggest` 500 (존재하지 않는 `goals.status` 컬럼 참조) | done | PASS | `c19c9a3` — progress 기반 라벨 파생. a824b89부터 2일간 잠복, tsc는 SQL 문자열 미검증 |
| `stream-parser` `rate_limit_event` status별 분기 (soft warning 오분류) | done | PASS | `2d5e6bd` — `rate_limit_info.status`(allowed/allowed_warning/rejected) 구분, rejected만 fatal. camelCase/snake_case 둘 다 파싱. +4 unit tests |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| `goals.status` 컬럼 부재 + stream-parser status 분기 (병렬 세션 2건 수리) | 2026-04-10 | PASS | `c19c9a3`, `2d5e6bd` — fast-forward merge, e817360과 보완적 2층 방어 구조 확립 |
| Scheduler loop + rate-limit false positive 수리 (5종 연속) | 2026-04-10 | PASS | `e817360`, `172c6f7` — executeOne blocked transition, isRateLimitError strict, PID lock, architect failure DB logging |
| Pulsar Analytics 목표를 Orbit에서 자율 실행 (dogfooding 검증) | 2026-04-10 | PASS | 6 tasks decompose, Task 1이 rate-limit 벽 (원인 재해석 필요 — 아래 참조) |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| P6 Fixture-masquerading-as-production-data | placeholder/TODO/하드코딩 seed가 실데이터처럼 집계되는 갭. Pulsar Analytics 목표 실행 결과가 이 패턴 잡아내는지 관찰 중 | **관찰 후 결정** |
| Pulsar 백엔드 ghost endpoints (5개) | `/dlq/items`, `/health/services`, `/health/retry-stats`, `/sla/metrics`, `/sla/violations` 미구현. 프론트는 graceful fallback | Medium (별도 목표) |
| Pulsar content 편집/승인 워크플로우 | PUT `/content/{id}` + `/escalation/action` UI 재활성화 | Low |
| Pulsar `dashboard/` 레거시 vanilla JS | `api.server:/dashboard`로 mount 유지 중. Next.js 단일화 여부 결정 | Low |
| Subtask verification | parent verification에 git diff 통합 | Medium |
| Goal 의존성 | depends_on_goal_id 미구현 | Low |
| 비개발자 UX Phase 2 | Git 설정 단순화, 검증 시각화 | Medium |
| `agents.parent_id` FK 부재 | 수동 정리 (마이그레이션 위험) | Low |
| tsx watch hot reload 중 in_progress 태스크 손실 | 매 파일 저장마다 recovery reset | Low (dev only) |
| npm publish | npmjs.com 미배포 | Low |

## Key Changes This Session (2026-04-09 ~ 2026-04-10)

### 1차: 가드 5단 체계 완성 (P0~P5)
Pulsar 감사에서 드러난 각기 다른 실패 패턴을 회귀 방지 가드로 체계화.

| 가드 | 감지 대상 | 동기 사례 (Pulsar) | 테스트 |
|---|---|---|---|
| **P0** | Silent CLI failure (ECONNRESET/401 leaks가 result_summary로 저장되고 done) | "로컬 개발 편의 스크립트 작성" | 11 |
| **P1** | Git diff scope drift (잘못된 디렉토리) | dashboard/*.js vs web/src/app/page.tsx | (evaluator inline) |
| **P2** | target_files/stack_hint 스코프 고정 (스키마 + decomposer + 구현 프롬프트 + UI) | Next.js 대신 vanilla JS로 오구현 | (schema + prompt) |
| **P3** | 실행 검증 hallucination ("렌더링 검증"류 태스크 auto-full scope) | "프론트엔드 12개 페이지 렌더링 검증" 빈 result_summary | 18 |
| **P4** | Entry Point Completeness (gated feature end-to-end 사용성) | users.yaml 빈 배열 + /login 없음 + dev bypass 없음 | 26 |
| **P5** | API Contract Mismatch (풀스택 계약 검증) | SLA `{items}` vs `{products}` crash, content status 매핑 crash, 5개 ghost endpoint | 16 |

총 **71/71 회귀 테스트 통과**. 커밋: `058f61b`, `b6caa90`, `188031a`.

### 2차: Pulsar 전수 복구 (프론트엔드만 adapt)
- **`/analytics` SLA crash**: `types/sla.ts` 재정의 (`items/healthy/violation_count`), `useSla` adapter, `SlaStatusCard` defensive + 새 스키마 렌더
- **`/content` placeholder 복원 + 계약 재맞춤**: 커밋 032c34d 파일 복원 후 `ContentSummary`를 백엔드 실제 응답(quality_score/status:draft/generated_at/channels[])에 맞춤. 상세 페이지 `[id]` → `[...id]` catch-all. 편집/승인 제거하고 read-only 뷰.
- **`/reliability` ghost endpoints**: use-health-stream이 404 수신 시 폴링 중단, 페이지 상단에 "백엔드 미구현" 안내 배너 (모든 API failed 시)
- **`/products` Button 접근성 경고**: `nativeButton={false}` 명시
- **Pulsar Next.js 대시보드 홈**: 8줄 placeholder → 277줄 KPI + 파이프라인 + 빠른 링크, Layer 3 검증 (빌드 + playwright + mock API)
- **PULSAR_DEV_MODE loopback bypass**: `dependencies.py`에 env + loopback AND 조건, tenant-default + admin AuthContext
- **`scripts/dev.sh`**: API + Web 동시 기동 + PULSAR_DEV_MODE 자동 export + JWT secret fallback

커밋: `22d68e0`, `c3d9951`, `627b780` (Pulsar), `058f61b` (Nova Orbit)

### 3차: Decomposer 안정성 3종 (Pulsar Analytics 목표 실전 검증 중 발견)
Pulsar dogfooding 태스크를 실전 실행하면서 드러난 연쇄 버그.

- **Prompt 압축**: P4/P5 섹션을 verbose past-incident 설명 → 5-7줄 규칙으로 압축. Claude output truncation 원인 제거.
- **Balanced-brace JSON recovery**: 기존 regex가 `target_files` 필드 추가 후 **절대 매칭 안 됨** 상태로 recovery 완전 무력화. `recoverTasksFromPartialJson()` 신설 — 문자-단위 string/brace 추적. production 실패 케이스 포함 10 tests.
- **In-flight decompose lock**: scheduler와 API가 동일 goalId로 동시 `decomposeGoal` 호출 시 같은 sessionKey로 race → SIGTERM(exit 143). `inflightDecompose` Set으로 두 번째 호출 조기 bail-out.

커밋: `086688b`

### 4차: Autopilot 전환/재시작/rate-limit self-heal + UX
- **`rescuePendingGoals`**: `projects.ts` PATCH에서 autopilot off→goal/full 전환 시 progress=0 + task 0개 goal 재스캔 → spec + decompose 파이프라인 재실행
- **Decompose 진행 상황 UX**: `decompose_started/completed/failed` activity 이벤트 + CTO `current_activity = decompose:{title}`, ProjectHome renderGoalCard가 agent activity 스캔해서 `decomposingGoalId` 로컬 state 없이도 pulse 표시
- **Architect phase UX**: CTO `current_activity = architect:{title}` + `architect_started` activity. Goal card가 `architect:` prefix도 인식.
- **Rate-limit self-heal**: `handleRateLimit`의 3회 연속 → `stopQueueInternal` → **15분 `RATE_LIMIT_COOLDOWN_MS` pause로 교체**. 카운터 리셋 + 자동 resume + timers 재건. 사용자 수동 개입 불필요.
- **Rate-limit pause overlay UX**: `nextRetryAt` 기반 실시간 카운트다운(`MM:SS`), "HH:MM에 자동 재개" 절대 시각, long cooldown은 **red** / 일반 backoff는 **amber** 테마 분리, **"지금 바로 재시도"** primary 버튼 강조 + "기다리지 않고 바로 재시도할 수 있습니다" subtitle. `resumeQueue()` 경로로 즉시 재개.

커밋: `086688b`, `1545665`, `d8d18c8`

### 5차: 잡다한 정리
- **`version.json` 거짓 dirty**: `sync-nova-rules.sh`가 매 실행마다 syncedAt만 갱신해서 git-dirty 상태 유발. `novaVersion/novaCommit` 비교 후 실제 변경 시만 재작성. 커밋: `a35d91c`

## Pulsar Dogfooding 결과 (2026-04-10 진행 중)
**목표 `1ca941bf9a966848` — Ghost/Naver Analytics 실제 수집 — fixture 제거 + 라이브 데이터 연동**
- 상태: 6 tasks decompose 완료 (P2 target_files/stack_hint 정확하게 채워짐)
- 진행: Task 1 "Ghost Admin API Analytics 클라이언트 구현" Architect phase 실행 중 (세션 종료 시점)
- autopilot=goal 모드, scheduler가 자율 실행 중
- **관찰 포인트**: Evaluator가 fixture-masquerading 패턴을 잡아내는지 여부. 못 잡으면 P6 가드 추가 근거 확보.

## Key Observation — Pulsar 이전 세션의 실패 원인 (장기)
어제 14:22에 Pulsar Analytics 실행이 rate-limit 3회 연속으로 **queue 완전 정지** → 오늘 아침까지 16시간 방치. 원인 체인:
1. Scheduler의 rate-limit stop이 영구(manual resume required) — **수정됨**
2. 서버 재시작이 여러 번 있었지만 재시작 직후 또 rate-limit에 걸려 같은 stop 경로 — **15분 cooldown으로 해소**
3. 사용자가 "autopilot이 멈춰있다"는 상태를 대시보드에서 명확히 볼 수 없음 — **overlay UX 개선됨**
4. 사용자가 "기다리지 않고 즉시 재시도 가능"임을 알 수 없음 — **"지금 바로 재시도" primary 버튼 + 카운트다운**

## Evidence Reinterpretation — "10:22:34 로그" 결정적 증거 재검토 (2026-04-10 병렬 세션)

e817360 커밋 메시지는 `10:22:34 로그의 "Rate limit hit: API usage limit reached"`를 **실제 quota 소진의 결정적 증거**로 제시했지만, 병렬 세션의 stream-parser 조사 결과 **이 문자열은 구 파서의 하드코딩 fallback**이었음:

```ts
// stream-parser.ts:140 (구)
result.errors.push(`Rate limit hit: ${parsed.message ?? "API usage limit reached. Please wait before retrying."}`);
```

`parsed.message ?? <fallback>` — Claude Code가 emit한 `rate_limit_event`에 `message` 필드가 없으면 **fallback 하드코딩 문자열**이 그대로 에러로 push됨. Context7 조사 결과 Claude Code CLI의 `rate_limit_event` 스키마는 `message` 필드 없이 `rate_limit_info.status` (`allowed` | `allowed_warning` | `rejected`)만 가짐. 즉 해당 이벤트는 **모두 fallback 경로**를 탔고, "API usage limit reached"는 코드가 찍은 문자열일 뿐 실제 API 응답이 아님.

재해석:
- **"allowed" / "allowed_warning"**: 정상/경고 (요청 계속 가능) — 구 파서가 fatal로 오분류 → STREAM_ERROR → scheduler 무한 루프
- **"rejected"**: 진짜 하드 블록 — 구 파서/신 파서 모두 fatal로 처리 (행동 동일)
- **stderr 기반 `isRateLimitError`**: 이 경로는 독립적으로 작동 (CLI-level 429). **진짜 quota 소진의 증거는 여기서 찾아야 함**

**따라서 당시 세션에서 본 증상의 원인은**:
- (A) 진짜 quota 소진 → stderr 경로로 검출 → scheduler가 handleRateLimit → 15분 cooldown **AND**
- (B) `allowed_warning` soft 이벤트가 stdout로 흘러들어옴 → 구 파서가 fatal로 오분류 → 추가 STREAM_ERROR → executeOne 무한 루프

둘 중 어느 쪽이 지배적이었는지는 당시 raw 로그(stderr 원문) 없이는 확정 불가. `rate_limit_hit` activity가 저장되기 시작한 건 e817360 이후라 과거 데이터에는 없음.

**교훈**: 다음에 비슷한 증상이 나면 `SELECT message FROM activities WHERE type='rate_limit_hit' ORDER BY id DESC LIMIT 5`로 stderr 원문부터 확인. 파서 fallback 문자열(`"API usage limit reached..."`)은 **증거가 아니라 코드 문자열**임을 기억.

**방어 구조 (양 세션 병합 후)**:
- 파서 레이어(`2d5e6bd`): `rate_limit_event`를 `status`별 분기, soft 이벤트는 무시
- 어댑터 레이어(`e817360`): `isRateLimitError` 엄격화, `MAX_RATE_LIMIT_RETRIES=1`
- 엔진 레이어(`e817360`): architect phase에 `detectAgentRunFailure` + DB activity 로깅
- 스케줄러 레이어(`e817360`): `throw` 시 `blocked + retry_count++` 강제 → 무한 루프 차단
- 프로세스 레이어(`e817360`): PID lock

## Last Activity
사용자 보고: "Claude 세션 여유있는데 시스템 오류 + rate-limit pause 반복". e817360 세션은 **scheduler 무한 루프 + adapter 재귀 + false positive 3종**을 5-way fix로 수리. 같은 시간대 병렬 세션(이 세션)은 독립적으로 조사해서 **stream-parser가 `rate_limit_event`의 `status` 필드를 무시하고 soft warning도 fatal로 push하던 버그**를 잡음 (`2d5e6bd`).

추가로 `/api/goals/suggest` 500 (존재하지 않는 `goals.status` 컬럼 참조 — a824b89부터 2일 잠복)도 동일 세션에서 수리 (`c19c9a3`).

두 세션 git pull 후 충돌 없이 fast-forward 병합 완료. 파일 겹침 0건, 의미론적으로는 파서→어댑터→엔진→스케줄러 **4층 방어 구조**로 통합됨. `rate_limit_event`의 실제 의미가 **상태 알림(state-change notification)**이지 **요청 실패(429)**가 아니라는 점을 반영해 위 Evidence Reinterpretation 섹션에 당시 진단 재해석 기록. | 2026-04-10

## Refs
- **Pulsar Analytics goal**: `1ca941bf9a966848` (autopilot=goal, decompose 6 tasks, Task 1 in progress)
- Last Verification: 71/71 unit tests + tsc (server+dashboard) + vitest + Playwright live verification (Pulsar 8 pages + dev-bypass dashboard)
- Session commits: `058f61b` → `a35d91c` → `22d68e0` → `b6caa90` → `c3d9951` → `627b780` → `188031a` → `086688b` → `1545665` → `d8d18c8` → `c19c9a3` → `2d5e6bd` → `e817360` → `172c6f7`
