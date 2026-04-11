# Nova State

## Current
- **Goal**: 스케줄러 retry 무한 루프 방지
- **Phase**: done (1 commit)
- **Blocker**: none

## Tasks (이번 세션 — 2026-04-11)
| Task | Status | Note |
|------|--------|------|
| zippit active 세션 kill + autopilot off | done | 21개 세션 중 19개 killed 상태, 2개 수동 종료 |
| ghost cleanup retry 한도 무시 버그 수정 | done | 영구 blocked 태스크가 todo로 부활하던 문제 |
| retryBlockedTasks 지수 백오프 적용 | done | 고정 10s → 10s/20s/40s 지수 증가 |
| 회로 차단기 — 반복 동일 검증 실패 감지 | done | 시그니처 비교 후 즉시 영구 blocked |
| shouldAutoStop in_review 포함 + 단일 에이전트 방어 | done | 큐 자동 종료 정확도 개선 |

## Recently Done (max 3)
| Task | Completed | Ref |
|------|-----------|-----|
| 스케줄러 retry 무한 루프 방지 (4가지 구조적 수정) | 2026-04-11 | `3c447a4` |
| 오케스트레이션 엔진 안정화 (25+ 이슈) | 2026-04-10 | `1dc62b5`→`41e47f0` (9 commits) |
| Nova Orbit UX/안정성 대규모 개선 (21 commits) | 2026-04-10 | 이전 세션 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| Blocked 태스크 수동 복구 UI | retry 소진된 blocked 태스크를 대시보드에서 재시도/재할당 | Medium |
| 3단계 팀 리더 위임 | FE 리더 → 팀원 위임 구조 (delegation.ts 확장) | Low |
| Subtask verification | parent verification에 git diff 통합 | Medium |
| Goal 의존성 | depends_on_goal_id 미구현 | Low |
| 비개발자 UX Phase 2 | Git 설정 단순화, 검증 시각화 | Medium |
| npm publish | npmjs.com 미배포 | Low |
| activities CASCADE | 프로젝트 삭제 시 activities 고아 레코드 가능 (현재 audit trail 보존) | Low |
| StatusBar 토큰 집계 정밀도 | cost_usd 이전 세션은 0 (수정 이후 세션부터 집계) | Info |

## Key Architecture Changes

### 스케줄러 retry 방어 체계 (2026-04-11)
1. **회로 차단기**: 연속 2회 동일 검증 실패 시 시그니처 비교 → 즉시 영구 blocked
2. **지수 백오프**: retry level별 쿨다운 (10s × 2^level), reassign은 40s
3. **ghost cleanup 한도 체크**: retry/reassign 소진된 stale 태스크는 todo가 아닌 blocked로 전이
4. **shouldAutoStop 보완**: in_review 포함 + 단일 에이전트 시 reassign 예산 소진

### 중복 태스크 방지 3층 방어 (2026-04-10)
1. **decomposeGoal 근본 가드**: 기존 태스크 존재 시 taskCount=0 반환, AI 세션 spawn 방지
2. **processNextGoal 이중 방어**: decompose 전 count 체크 + auto-approve를 decompose 분기 안으로
3. **6개 호출 경로 전부 보호**: triggerAutopilotDecompose, rescuePendingGoals, triggerFullAutopilot 등

### 개발 모드 토큰 절약 (2026-04-10)
- `NOVA_NO_AUTO_QUEUE=true` 환경변수 → dev:server에 기본 적용

## Last Activity
- scheduler retry 방어 로직 검증 PASS (QA: 18 시나리오, 1 FAIL 수정) | 2026-04-11T10:30:00+09:00

## Refs
- Latest commit: `3c447a4`
- Last Verification: tsc (server+dashboard) PASS
