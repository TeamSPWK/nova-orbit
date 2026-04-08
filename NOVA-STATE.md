# Nova State

## Current
- **Goal**: goal 재진입 순서 버그 수정 (sort_order 충돌 + mode 토글 가드)
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| Fix 1: engine.ts generateGoalsFromMission sort_order 오프셋 | done | PASS | `MAX(sort_order)+1+index` + validGoals 재인덱싱 |
| Fix 2: projects.ts PATCH 재진입 가드 | done | PASS | `progress<100` 있으면 CTO 재생성 스킵 |
| Fix 2b: queue 정지 상태일 때 startQueue 재시작 | done | PASS | blocked-only Hard-Block 방어 (QA 지적) |
| Fix 3: goals.ts 사용자 수동 생성 sort_order | done | PASS | 같은 근본 버그, 범위 확장 |
| Fix 4: orchestration.ts extractAndCreateCtoGoal sort_order | done | PASS | 같은 근본 버그, 범위 확장 |
| Adversarial QA 서브에이전트 검증 | done | PASS | Hard-Block 1 + High 2 + Medium 2 전부 반영 |
| DB 시뮬레이션 (in-memory sqlite) | done | PASS | 5 기존+3 신규 시나리오 순서 정합성 확인 |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| goal 재진입 순서 버그 (sort_order 충돌 + full 재진입 CTO 재생성) | 2026-04-08 | PASS | 4파일, QA+DB 시뮬레이션 |
| 전체 버그 헌트 2차 (task:usage 평면/nested 불일치, 활동피드 필드명, i18n 키, 하드코딩 영문) | 2026-04-08 | PASS | 8파일, tsc+빌드 통과 |
| 버그 헌트 + 수정 + 순차 실행 (Critical 4 / High 6 / Medium 8 / Low 2 + sequential) | 2026-04-08 | PASS | 3 commits, tsc+빌드 통과 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| Subtask verification | parent verification에 git diff 통합 (현재는 parent task 단독 verify) | Medium |
| Goal 의존성 | depends_on_goal_id 미구현 (현재는 priority + sort_order) | Low |
| Sequential vs parallel goal 옵션 | 프로젝트별 선택 가능하게 (현재 sequential 고정) | Low |
| Rate limit 모달 | 진짜 rate limit일 때 전체 딤 모달 (현재는 활동 로그만) | Medium |
| 비개발자 UX Phase 2 | Git 설정 단순화, 검증 시각화 | Medium |
| npm publish | npmjs.com 미배포 | Low |
| `agents.parent_id` FK 부재 | 코드에서 수동 정리 (마이그레이션 위험으로 보류) | Low |

## Key Changes This Session
### 전체 버그 헌트 2차 (신규 커밋)
- `TaskList.tsx` — task:usage payload nested 구조 읽도록 수정 (totalCostUsd/inputTokens/outputTokens). 기존 평면 필드(`costUsd`, `totalTokens`)는 engine에서 보내지 않아 항상 undefined였음. TaskList 비용/토큰 배지 복구.
- `ActivityFeed.tsx` — `p.files` → `p.filesChanged`, `p.pr` → `p.prUrl`. "개 파일 커밋"이 빈 count로 표시되고 PR 생성 이벤트도 무시되던 버그.
- `ko.ts`, `en.ts` — `gitCommitted` 문구 자연스럽게("파일 {count}개 커밋"). `specGeneratedByAI/Manual`, `specHeaderTitle`, `specFlowAction/Expected`, `specFeatureRequirements`, `keyboardShortcutsClose`, `claudeStatusUnavailable` 신규 키 추가.
- `GoalSpecPanel.tsx` — 하드코딩 영문("Structured Spec", "Action", "Expected", "Requirements", "User does...", "System responds...", "AI") 전부 i18n화. `specEdit`("편집") 키를 생성자 라벨로 오용하던 문제 수정.
- `KeyboardShortcuts.tsx`, `StatusBar.tsx` — "Esc to close", "Claude status unavailable" i18n화.
- `verification.ts` — POST /verifications broadcast 시 `JSON.parse` try/catch로 방어. 잘못된 dimensions/issues가 저장되면 전체 응답이 500으로 터지던 위험 제거.

### 버그 헌트 + 수정 (a824b89)
- `evaluator.ts` — concurrent verification guard 제거 + evaluatorId sessionKey 분리
- `engine.ts`, `delegation.ts`, `scheduler.ts` — delegated parent task verify 통합 (parentVerifier 주입)
- `orchestration.ts` — references path.resolve + workdir prefix 검증 (LFI 차단)
- `engine.ts` — mission JSON truncated recovery + transaction
- `tasks.ts`/`engine.ts`/`delegation.ts` — updateGoalProgress 단일 atomic UPDATE + clamping
- `goals.ts`/`tasks.ts` — POST/PATCH 입력 검증 + MAX_TITLE_LEN/MAX_DESC_LEN
- `tasks.ts` — POST에 goal_id/project_id/assignee_id 존재 확인
- `scheduler.ts` — autoAssignUnassigned 경고 activity (5분 dedup)
- `websocket.ts` — 미인증 연결 메시지 차단 + 10초 close
- `session.ts` — keyToSessionRowId 맵으로 정확한 row 업데이트, sibling 보호
- `claude-code.ts` — proc.on('close')에 signal/killed 정보 + stderr enrichment
- `goals.ts`/`tasks.ts` — PATCH/DELETE를 db.transaction()으로 래핑
- `projects.ts` — merge-all IIFE finally try-wrap + .catch() 방어
- `scheduler.ts` — resumeQueue에서 timers 비어있을 때 새 timer 생성

### 목표 단위 순차 실행 (214ee3b, 05600c9)
- `scheduler.ts` pickNextTasks — startedGoal/nextGoal 쿼리로 1 active goal 선택
- `scheduler.ts` — stale in_progress 자동 복구 (assignee !busy && idle > 30min)
- `scheduler.ts`, `agents.ts` — dead 'verified' status 정리 (4곳)

## Last Activity
- Pulsar 프로젝트 사용자 제보: Full Auto → Semi Auto → Full Auto 토글 시 CTO가 새 goal을 즉시 생성하고 기존 goal 사이에 섞임. 근본 원인 2개 확인 — (1) 신규 goal의 `sort_order = index`가 기존 goal과 충돌, (2) `triggerFullAutopilot`이 재진입 조건 없이 호출됨. nova:qa-engineer 서브에이전트 검토에서 추가로 "blocked-only goal + queue 정지 상태 재진입" Hard-Block 발견 → `startQueue` 재시작 보강. orchestration.ts / goals.ts의 동일 근본 버그 경로도 함께 수정. 실제 sqlite DB 시뮬레이션으로 순서 정합성 검증. | 2026-04-08

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Last Verification: tsc PASS + build PASS + adversarial QA PASS + DB 시뮬레이션 PASS
- Commits: a824b89 → 214ee3b → 05600c9 → 353ec22 → ac3ebba → (신규: goal 재진입 순서)
