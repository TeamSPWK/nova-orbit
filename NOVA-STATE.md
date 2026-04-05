# Nova State

## Current
- **Goal**: 방어로직 전면 강화 + Autopilot 자동화 완성 + 실시간 UX
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| Autopilot 자동실행 | done | PASS | pending_approval → 자동 승인, 큐 자동 시작 |
| 방어로직 1차 (34건) | done | PASS | constants.ts, 하드코딩 제거, 에이전트 stuck 방지 등 |
| blocked 자동 재시도 | done | PASS | retry_count + 쿨다운 + 에이전트 재할당 + 목표 진행 보장 |
| 서버 재시작 큐 복구 | done | PASS | Autopilot 프로젝트 큐 자동 시작 |
| 방어로직 2차 (9건) | done | PASS | 리소스 삭제 안전화, WS 보안, DB↔WS 상태 동기화 |
| 방어로직 3차 (7건) | done | PASS | worktree, git, 세션, 메모리 안전화 |
| ENOENT 근본 해결 | done | PASS | PATH 보충, 환경 에러 즉시 포기 |
| Evaluator 0점 문제 | done | PASS | 비코드 태스크 conditional pass |
| 동적 타임아웃 | done | PASS | 고정 5분 → 활동 기반 (출력 있으면 연장) |
| 실시간 에이전트 출력 | done | PASS | stream-json 파싱 → 아이콘+요약, 클릭 히스토리 |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| 방어로직 전면 강화 (55+건) | 2026-04-05 | PASS | 14커밋, 서버+대시보드 |
| 실시간 UX (출력 파싱+펼침) | 2026-04-05 | PASS | agentOutputParser.ts 신규 |
| zippit 실전 Autopilot 검증 | 2026-04-05 | PASS | 19태스크 중 18완료, 자동 복구 동작 확인 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| npm publish | npmjs.com 미배포 | Low |
| 동시 verification 충돌 | 경고 로그만 추가, 세션 격리는 미구현 | Medium |
| 대시보드 오프라인 모드 | WS 끊김 시 캐시 표시 없음 | Low |

## Key Changes This Session
- `server/utils/constants.ts` — 공유 상수 + env var 오버라이드 (14개 상수)
- 에이전트 삭제 시 모든 비완료 Task assignee 클리어
- 스케줄러: fixDanglingAssignees → retryBlockedTasks → autoAssignUnassigned → pickNextTasks
- tasks 테이블: retry_count, reassign_count 컬럼 추가
- 동적 타임아웃: lastActivity 기반 idle 감지
- `dashboard/src/utils/agentOutputParser.ts` — stream-json → 사람 읽기 파싱

## Last Activity
- 방어로직 전면 강화 + Autopilot 완성 + 실시간 UX | 2026-04-05

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Design: docs/designs/phase2-production-ready.md
- Last Verification: tsc PASS + build PASS (server + dashboard)
