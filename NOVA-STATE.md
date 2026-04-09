# Nova State

## Current
- **Goal**: Pulsar 8h+ stuck state 진단 + root cause 5건 수정 + stuck detector 방어 레이어
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| scheduler 타이머 지수 증식 차단 | done | PASS | scheduleNextPoll clearTimeout 가드 (d36fa92) |
| goal_specs stuck generating 자동 복구 | done | PASS | runtime catch + startup recovery (d428437) |
| reviewer/qa architect phase 스킵 | done | PASS | 5-10분/태스크 절약 (6a6a436) |
| 워크트리 pointer 노이즈 commit 차단 | done | PASS | :(exclude,top) pathspec + .gitignore 자동 append (9088656) |
| evaluator message 필드 다중 폴백 | done | PASS | auto-fix "No description" 루프 해소 (c845dc3) |
| Architect residue 자동 sweep | done | PASS | prompt 경고 + post-hook auto-commit (970e262) |
| Reviewer gate: permanent blocked 형제 skip | done | PASS | gate 쿼리 필터 추가 (970e262) |
| updateGoalProgressExcludingBlocked poll마다 호출 | done | PASS | early-return 경로 고정 (970e262) |
| git-error 즉시 permanent blocked | done | PASS | 브랜치 폭증 차단 (970e262) |
| Stuck detector + diagnoseStuck | done | PASS | 5 진단 코드 + autopilot_warning broadcast (970e262, dbf4f1d) |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| Pulsar 8h stuck 사건 — root cause 4 + 방어 레이어 | 2026-04-09 | PASS | 임시 해결 + 970e262 + dbf4f1d |
| goal 재진입 순서 버그 (sort_order 충돌 + full 재진입 CTO 재생성) | 2026-04-08 | PASS | 4파일, QA+DB 시뮬레이션 |
| 전체 버그 헌트 2차 (task:usage, 활동피드 필드명, i18n 키, 하드코딩 영문) | 2026-04-08 | PASS | 8파일, tsc+빌드 통과 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| Subtask verification | parent verification에 git diff 통합 | Medium |
| Goal 의존성 | depends_on_goal_id 미구현 (현재는 priority + sort_order) | Low |
| Sequential vs parallel goal 옵션 | 프로젝트별 선택 가능하게 | Low |
| Rate limit 모달 | 진짜 rate limit일 때 전체 딤 모달 | Medium |
| 비개발자 UX Phase 2 | Git 설정 단순화, 검증 시각화 | Medium |
| npm publish | npmjs.com 미배포 | Low |
| `agents.parent_id` FK 부재 | 수동 정리 (마이그레이션 위험) | Low |
| tsx watch hot reload 중 in_progress 태스크 손실 | 매 파일 저장마다 recovery가 reset → 태스크 재실행 | Low (dev only) |

## Key Changes This Session (2026-04-09)

### 임시 해결 (Pulsar repo + DB 직접 조작)
- `docs/design/auth-infrastructure.md` 수동 commit (Pulsar 73c0e06)
- `agent/platform-dev/locale-aware-quality-gate-dd88eea7` 수동 merge to main (Pulsar)
- Stale locale-aware 브랜치 6개 삭제
- Nova DB: 영구 blocked 태스크 `02fe0bab538052af` → done 전환 + 모든 goal progress 재계산

### Root Cause 수정 (970e262)
- **Architect phase 파일 오염**: 프롬프트에 "⚠️ Read-Only Session, Do NOT use Write/Edit/NotebookEdit" 명시 + 종료 후 `git status --porcelain` 체크 → residue 있으면 `docs(nova-architect):` prefix로 auto-commit + autopilot_warning 기록
- **Reviewer gate 영구 lock**: sibling 쿼리에 `NOT (blocked AND retry_count >= MAX AND reassign_count >= MAX)` 추가. permanent-blocked는 "done 대체"로 취급
- **Progress % 고착**: `updateGoalProgressExcludingBlocked`를 `pickNextTasks` 상단에서 idempotent 호출. 기존엔 `retryBlockedTasks`의 tail에서만 호출 → exhausted 없으면 early return으로 영영 호출 안됨
- **Git merge conflict 브랜치 폭증**: executeTask의 git workflow 실패 시 retry_count/reassign_count를 즉시 MAX로 세팅 후 blocked 전환. 첫 번째 git 실패에서 바로 permanent → 재할당 루프 중단

### 방어 레이어 — Stuck State 감지 (970e262, dbf4f1d)
- scheduler에 `stuckState` Map + `checkStuckState` + `diagnoseStuck` 추가
- `pickNextTasks`가 빈 배열 반환 + `busy.size === 0`일 때만 카운팅 (False positive 방지 — dbf4f1d)
- 30회 연속(≈30초) empty poll → 진단 수행
- 진단 코드 5종: `no_agents` / `reviewer_gate_lock` / `permanent_blocked` / `all_blocked` / `unknown_idle`
- `🟡 자동 실행 정체: <이유>` activity + `autopilot:stuck` WebSocket broadcast + `project:updated` 동반 발송
- 5분 re-warn 간격, 진단 코드 변경 시 즉시 re-warn

### 이전 세션 잔여 수정 (커밋만 정리)
- `d36fa92` scheduler 타이머 지수 증식 (100% CPU 포화 Hard-Block)
- `d428437` goal_specs `_status:"generating"` 영구 고착 (runtime + startup)
- `6a6a436` reviewer/qa architect phase 스킵
- `9088656` .nova-worktrees pointer noise + gitignore 자동
- `c845dc3` evaluator message 필드 폴백 (description/detail/text/issue/title/reason/problem)

## Last Activity
- 사용자가 대시보드 확인해서 Pulsar가 8시간+ 멈춰있다고 제보. 진단 결과 `docs/design/auth-infrastructure.md`가 architect phase에서 project root에 staged-uncommitted 상태로 생성됨 → 모든 다른 worktree의 merge가 "local changes would be overwritten"로 실패. locale-aware quality gate 태스크 6번 재시도 → 브랜치 6개 생성 → 전부 실패 → permanent blocked → reviewer gate가 이 blocked 형제에 영영 매달림 → 다국어 goal의 2개 리뷰어 태스크가 deferred → scheduler는 sequential goal mode라 다음 goal로 넘어가지 못함 → 8시간 idle. 임시 해결(수동 merge + DB 패치)로 즉시 복구 후 root cause 4건 + stuck detector 방어 레이어 커밋. | 2026-04-09

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Last Verification: tsc PASS + build PASS + 서버 hot reload + 리뷰어 태스크 정상 재개 확인
- Commits: a824b89 → 214ee3b → 05600c9 → 353ec22 → ac3ebba → 201806c → d36fa92 → d428437 → 6a6a436 → 9088656 → c845dc3 → 970e262 → dbf4f1d
