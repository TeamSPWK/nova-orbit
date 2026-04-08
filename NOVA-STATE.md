# Nova State

## Current
- **Goal**: 버그 헌트 + 수정 + 목표 단위 순차 실행 (세션 마무리)
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| Critical 수정 (verification guard, path traversal, mission JSON) | done | PASS | sessionKey 분리 + path.resolve guard + truncated recovery |
| High 수정 (delegated parent verify, progress race, 입력 제한, assignee hang, WS auth, sessions row) | done | PASS | qualityGate 주입 + atomic UPDATE clamping + 검증 6건 |
| Medium 수정 (JSON parse, PATCH/DELETE txn, resumeQueue, signal info, merge-all) | done | PASS | db.transaction 래핑 + IIFE catch + close signal log |
| Low 수정 (POLL_INTERVAL, dead 'verified' status) | done | PASS | 3000→1000ms, 4곳 != 'done' 정리 |
| 목표 단위 순차 실행 (pickNextTasks 재설계) | done | PASS | 한 번에 1 active goal, 내부 병렬 유지 |
| Sequential goal stale 안전망 | done | PASS | 30분+ idle in_progress 자동 todo 복구 |
| 서버 재시작 + 동작 확인 | done | PASS | recovery 1건 복구, high goal "CLI 롤백" 즉시 실행 |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| 버그 헌트 + 수정 + 순차 실행 (Critical 4 / High 6 / Medium 8 / Low 2 + sequential) | 2026-04-08 | PASS | 3 commits, tsc+빌드 통과 |
| Full Autopilot 안정화 + UX 대폭 개선 | 2026-04-08 | PASS | 15+파일, 세션/큐/UX 전반 |
| Orbit UX 6개 개선 | 2026-04-06 | PASS | 15파일, +450줄 |

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
- 버그 헌트 + 수정 + 목표 단위 순차 실행 적용 + 깨끗한 재시작. Pulsar에서 high priority "발행 콘텐츠 롤백" goal이 즉시 active로 선택되어 "CLI 롤백 커맨드 구현" 실행 중. 다른 3개 goal(플러그인/다국어/A/B)은 대기. | 2026-04-08

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Last Verification: tsc PASS (server + dashboard) + vite build PASS + dry-run on Pulsar PASS
- Commits: a824b89 (25 bugs) → 214ee3b (sequential goal) → 05600c9 (safety net + cleanup)
