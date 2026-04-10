# Nova State

## Current
- **Goal**: 오케스트레이션 엔진 안정화 + 대시보드 UX 개선
- **Phase**: done (9 commits pushed)
- **Blocker**: none

## Tasks (이번 세션 — 2026-04-10 저녁)
| Task | Status | Note |
|------|--------|------|
| nova/zippit/nova-landing 코드 복구 | done | 오늘 에이전트 커밋 전부 리버트 + force push 3개 리포 |
| DB 중복 태스크 정리 | done | 36개 제거 (중복 todo/blocked/in_progress) |
| 중복 태스크 근본 수정 | done | decomposeGoal 가드 + 6개 호출 경로 보호 |
| NOVA_NO_AUTO_QUEUE 개발 모드 자동 큐 차단 | done | dev:server에 기본 적용, 재시작 시 토큰 낭비 방지 |
| processNextGoal auto-approve 위치 수정 | done | decompose 성공 분기 안으로 이동 |
| inflightDecompose 락 누수 수정 | done | 외부 try-finally로 모든 에러 경로 cleanup |
| Task DELETE broadcast 추가 | done | 대시보드 stale 상태 해소 |
| autopilot off sessions kill | done | 전환 시 프로세스 종료 + DB 정리 |
| rescuePendingGoals spec 보존 | done | INSERT OR IGNORE + 조건부 UPDATE |
| reassign exhausted 무한 루프 수정 | done | reassign_count = MAX 강제 설정 |
| worktree cleanup 로깅 | done | silent catch → log.warn |
| 부모 태스크 verify 중복 방지 | done | CAS-style 원자적 전이 |
| goal progress/stale broadcast 추가 | done | 2건 broadcast 누락 수정 |
| 서버 MEDIUM 5건 수정 | done | verification broadcast, EPERM, worktree, pending_approval, goal delete session |
| 대시보드 UX 5건 | done | FAIL 이슈 목록, 툴팁, 타임라인 in_review, FAIL 뱃지 hover |
| StatusBar 자체 데이터 전환 | done | /api/orbit-status + cost_usd 저장 버그 수정 |

## Recently Done (max 3)
| Task | Completed | Ref |
|------|-----------|-----|
| 오케스트레이션 엔진 안정화 (25+ 이슈) | 2026-04-10 | `1dc62b5`→`41e47f0` (9 commits) |
| Nova Orbit UX/안정성 대규모 개선 (21 commits) | 2026-04-10 | 이전 세션 |
| Scheduler loop + rate-limit 수리 (5종) | 2026-04-10 | `e817360`, `172c6f7` |

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

## Key Architecture Changes (이번 세션)

### 중복 태스크 방지 3층 방어
1. **decomposeGoal 근본 가드**: 기존 태스크 존재 시 taskCount=0 반환, AI 세션 spawn 방지
2. **processNextGoal 이중 방어**: decompose 전 count 체크 + auto-approve를 decompose 분기 안으로
3. **6개 호출 경로 전부 보호**: triggerAutopilotDecompose, rescuePendingGoals, triggerFullAutopilot 등

### 개발 모드 토큰 절약
- `NOVA_NO_AUTO_QUEUE=true` 환경변수 → dev:server에 기본 적용
- 서버 재시작 시 autopilot 큐 자동 시작 차단

### StatusBar 자체 데이터
- `/api/orbit-status` 신규 — 활성 에이전트, 오늘 비용/토큰/세션 집계
- `cost_usd` DB 저장 버그 수정 (선언만 되고 저장 안 되던 문제)
- 터미널 5h %는 보조 정보로 유지

## Last Activity
- /nova:review → PASS — 3회 반복 점검으로 전체 플로우 검증 완료 | 2026-04-10T22:00:00+09:00

## Refs
- Session commits: `1dc62b5` → `ad273c8` → `a3695ac` → `27eed27` → `2bffbcc` → `30cef1d` → `41e47f0`
- Last Verification: tsc (server+dashboard) PASS
