# Nova State

## Current
- **Goal**: Nova Orbit UX/안정성 대규모 개선 — 버그 수정 8건 + 기능 5건 + UX 7건
- **Phase**: done (21 commits pushed)
- **Blocker**: none

## Tasks (이번 세션 — 2026-04-10 오후)
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| `/api/goals/suggest` 500 수정 | done | PASS | `c19c9a3` — goals.status 컬럼 부재, progress 기반 라벨 파생 |
| `rate_limit_event` status별 분기 | done | PASS | `2d5e6bd` — soft warning 오분류 → rejected만 fatal, +4 unit tests |
| Goal 순차 decompose | done | PASS | `abedc3a` — 이전 goal 완료 전 다음 goal decompose 차단, 토큰 절감 |
| 에이전트별 모델 선택 | done | PASS | `abedc3a` — DB schema + 3단 resolution (agent>role>CLI), CTO/PM→Opus, 나머지→Sonnet |
| AI 목표 추천 백그라운드 UX | done | PASS | `0089265` — 다이얼로그 닫아도 fetch 계속, 배너로 결과 알림 |
| CTO 보조 활동 시각적 구분 | done | PASS | `4e33a48` — 파란=설계/분할/기획, 초록=구현. OrgChart+AgentDetail+개요탭 |
| Role 기반 태스크 분배 + 에이전트 복제 | done | PASS | `a2e20f8` — decompose 라운드 로빈 + autoAssign role 매칭 + clone API |
| 태스크 중복 실행 방지 (exit 143) | done | PASS | `ae663c3` — atomic CAS guard, status IN('todo','pending_approval')만 진입 |
| 스마트 팀 구성 프롬프트 누락 | done | PASS | `d41aae1` — SuggestedAgent에 systemPrompt 추가, create 시 전달 |
| inferRole 근본 수정 | done | PASS | `0f1b913` — frontmatter role > filename > name regex > custom. description 제외 |
| 세션 소진 시 rate-limit 모달 표시 | done | PASS | `0f1b913` — CLI exit 1 + empty stderr → handleRateLimit 분류 |
| Autopilot 모드 전환 시 기존 태스크 자동 시작 | done | PASS | `11ef303` — off→goal/full 시 todo 큐 즉시 시작 + AutopilotModal 안내 배너 |
| 세션 관리 페이지 | done | PASS | `e8f46f7` — API 4개 + 대시보드 탭 (활성/고아/필터/정리) |
| 서버 시작 시 모든 active 세션 정리 | done | PASS | `61d8724` — recovery에서 전체 active→killed |
| 세션 PID 즉시 기록 | done | PASS | `b7ca4b9` — spawn 직후 emit("pid"), 고아 오판 근본 해결 |
| Architect 세션 중복 방지 | done | PASS | `7e59925` — 고유 sessionKey + spawn 시 이전 DB row killed 전환 |
| 세션 통계 프로젝트별 필터 | done | PASS | `1baa9eb` — stats API에 projectId 파라미터 |
| 고아 세션 grace period | done | PASS | `b5049b6` — 시작 30초 미만 제외 |
| 경고 로그 스팸 방지 | done | PASS | `2f2d112` — permanently blocked 경고 goal당 1회 |
| 작업 분할 버튼 중복 방지 | done | PASS | `4795c0a` — isDecomposing 최상위 체크 |
| 기획서 생성 중 버튼 비활성 + 호버 툴팁 | done | PASS | `4354ec5` — 작업 분할/+태스크 모두 비활성, span wrapper 툴팁 |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| Nova Orbit UX/안정성 대규모 개선 (21 commits) | 2026-04-10 | PASS | 버그 8 + 기능 5 + UX 7 |
| Scheduler loop + rate-limit false positive 수리 (5종) | 2026-04-10 | PASS | `e817360`, `172c6f7` |
| 가드 5단 체계 완성 (P0~P5) + 71 회귀 테스트 | 2026-04-09~10 | PASS | `058f61b`, `b6caa90`, `188031a` |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| Graceful shutdown (tsx watch) | 서버 재시작 시 in_progress 태스크 retry_count 미증가 복원 | Medium (dev only) |
| Blocked 태스크 수동 복구 UI | retry 소진된 blocked 태스크를 대시보드에서 재시도/재할당 | Medium |
| 3단계 팀 리더 위임 | FE 리더 → 팀원 위임 구조 (delegation.ts 확장) | Low |
| P6 Fixture-masquerading | placeholder/TODO 데이터가 실데이터처럼 집계 | 관찰 후 결정 |
| Subtask verification | parent verification에 git diff 통합 | Medium |
| Goal 의존성 | depends_on_goal_id 미구현 | Low |
| 비개발자 UX Phase 2 | Git 설정 단순화, 검증 시각화 | Medium |
| npm publish | npmjs.com 미배포 | Low |

## Key Architecture Changes (이번 세션)

### 4층 Rate-Limit 방어
1. **파서**: `rate_limit_event` → `status`별 분기 (allowed/warning=무시, rejected=fatal)
2. **어댑터**: `isRateLimitError` 엄격화 + `MAX_RATE_LIMIT_RETRIES=1` + 세션 소진 감지
3. **엔진**: architect phase `detectAgentRunFailure` + CAS guard (중복 실행 방지)
4. **스케줄러**: `handleRateLimit` 통합 (rate-limit + session exhaustion) + blocked 전환

### 에이전트 모델 선택
- DB `agents.model` 컬럼 + `ROLE_DEFAULT_MODEL` 매핑
- 3단 resolution: agent.model > role default > CLI default
- CTO/PM → Opus, 구현/리뷰 → Sonnet

### 세션 관리
- API: GET /sessions, GET /sessions/stats, DELETE /sessions/:id, POST /sessions/cleanup
- 대시보드 "세션" 탭: 활성/종료/전체 필터, 고아 감지+정리, PID 표시
- spawn 직후 emit("pid") → DB 즉시 기록, grace period 30초
- recovery: 서버 시작 시 모든 active → killed

### Role 기반 태스크 분배
- `findAgent`: roleAssignCount 라운드 로빈 (같은 role 복수 에이전트 균등 분배)
- `autoAssignUnassigned`: 태스크 제목에서 role 힌트 추출 → 매칭 에이전트 우선
- `inferRole` 3-layer: frontmatter role > filename > name regex > custom

## Last Activity
Nova Orbit 대규모 UX/안정성 개선 세션. 버그 수정 8건 (goals.status, rate_limit_event 오분류, 중복 실행 exit 143, inferRole false positive, 세션 PID/고아, architect 중복, 로그 스팸, 파싱 에러), 기능 추가 5건 (순차 decompose, 모델 선택, 에이전트 복제, autopilot 자동 시작, 세션 관리 페이지), UX 개선 7건 (AI 추천 배너, CTO 활동 구분, 모드 전환 안내, 분할/태스크 버튼 비활성+툴팁). zippit/nova 두 프로젝트에서 autopilot 실행 모니터링 확인 — 정상 진행 중 (zippit done=17, nova done=5+4 WIP). | 2026-04-10

## Refs
- Session commits: `c19c9a3` → `2d5e6bd` → `cda4413` → `abedc3a` → `0089265` → `4e33a48` → `a2e20f8` → `ae663c3` → `d41aae1` → `80bfa78` → `4795c0a` → `0f1b913` → `11ef303` → `e8f46f7` → `61d8724` → `b7ca4b9` → `7e59925` → `1baa9eb` → `b5049b6` → `2f2d112` → `9b42838` → `ac924af` → `bc31629` → `4354ec5`
- Last Verification: tsc (server+dashboard) PASS, vitest 148/151 PASS (3 pre-existing)
