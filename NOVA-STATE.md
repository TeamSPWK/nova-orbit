# Nova State

## Current
- **Goal**: Git-error 분류 시스템 + Autopilot 자동 복구 철학 (Pulsar 이후 재발 방지)
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| pulsar 2 blocked tasks 수동 복구 | done | PASS | ignored-file false positive, DB 패치 (세션) |
| classifyGitError 3분류 시스템 | done | PASS | recoverable/permanent/benign, 8/8 unit test |
| commitTaskResult explicit-paths-from-porcelain | done | PASS | git add -A → status -z 파싱 → explicit add |
| engine git-error classify 분기 | done | PASS | benign→done, permanent→MAX, recoverable→retry 예산 유지 |
| reviewer/qa managed directory 경고 + sweep | done | PASS | 프롬프트 섹션 + post-kill 감지 |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| Git-error 분류 + Autopilot 자동 복구 (reviewer ignored-file false positive) | 2026-04-09 | PASS | engine.ts + git-workflow.ts, tsc+build+unit+integration |
| Pulsar 8h stuck 사건 — root cause 4 + 방어 레이어 | 2026-04-09 | PASS | 임시 해결 + 970e262 + dbf4f1d |
| goal 재진입 순서 버그 (sort_order 충돌 + full 재진입 CTO 재생성) | 2026-04-08 | PASS | 4파일, QA+DB 시뮬레이션 |

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

## Key Changes (2026-04-09, 2차 — Git-error 분류 + Autopilot 자동 복구)

### 발견된 후속 이슈
- Pulsar 대시보드에 blocked 태스크 2개 잔존: 로컬라이제이션 파이프라인 **통합 테스트** / **품질 검증**
- 두 태스크 모두 qa-reviewer가 실제로 검증 완료 (result_summary에 AC1~AC5 리포트)
- 그런데 git workflow 단계에서 `git add failed: The following paths are ignored by .gitignore: .claude/worktrees, .nova-worktrees` 에러
- 970e262의 "git-error 즉시 permanent blocked"가 **복구 가능한 에러까지 흡수**해서 permanent 처리

### 임시 복구 + 근본 수정
- DB 패치: 두 태스크 → done, goal `3e16c6d3` progress 재계산, activity에 근거 기록
- `classifyGitError()` 추가 (git-workflow.ts): recoverable/permanent/benign 3분류, unknown은 recoverable default (Autopilot 우선주의)
- `commitTaskResult` 재구현: `git add -A -- . :(exclude)` 패턴 폐기 → `git status --porcelain -z` 파싱해서 **explicit path add**. status가 이미 exclude 처리하므로 ignored-file 에러 **불가능**. rename/copy/공백 파일명 안전 처리
- `engine.ts` git-error 분기 2곳 (initial + re-verify) 모두 classify 기반:
  - `benign` → 즉시 done 전환 (성공 처리)
  - `permanent` → 기존 로직 (MAX 강제 → 영구 blocked, skip ahead)
  - `recoverable` → MAX 강제 **제거**, 기존 retry 예산 존중 → autopilot이 스스로 복구
- reviewer/qa task (needs_worktree=0) 프롬프트에 **Managed Directories** 섹션 추가 (`.nova-worktrees/`, `.claude/worktrees/` 쓰기 금지)
- killSession 직후 방어 sweep: managed dir residue 감지 시 `autopilot_warning` activity
- `GitWorkflowResult`에 `errorClass`, `errorCode` 노출 / `runGitWorkflow` 반환 타입 확장

### Autopilot 철학 반영
> **기존**: git error → 무조건 permanent blocked (브랜치 폭증 방지 과잉 반응)
> **변경**: git error 분류 → permanent만 skip ahead, recoverable은 autopilot이 자동 복구 / retry 예산 내 재시도. **사용자 개입 없이 스스로 해결하는 것이 Full Auto의 본질**

### 검증
- tsc PASS / build PASS
- `classifyGitError` unit test 8/8 PASS (ignored-file, nothing-to-commit, merge-conflict, branch-exists, local-changes-overwrite, index-lock, auth-failed, unknown)
- `commitTaskResult` 격리 repo 통합 테스트: residue + 공백 파일명 + ignored dir 동시 존재 → 정확한 파일만 커밋, 에러 없음

## Last Activity
- 사용자 제보: pulsar에 blocked 태스크 2개. 진단 결과 qa-reviewer가 검증 완료했으나 `.claude/worktrees`, `.nova-worktrees` ignored-file 에러로 permanent blocked. 970e262의 과보호 로직이 복구 가능한 케이스까지 잡음. DB 패치로 즉시 복구 후 **Autopilot은 복구 가능한 에러를 자동으로 해결해야 한다**는 방향으로 git-error 3분류 시스템 + commitTaskResult explicit-paths 재구현 + reviewer/qa defensive sweep 커밋. | 2026-04-09

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Last Verification: tsc PASS + build PASS + classifyGitError 8/8 + commitTaskResult 통합 테스트 PASS
- Commits: a824b89 → 214ee3b → 05600c9 → 353ec22 → ac3ebba → 201806c → d36fa92 → d428437 → 6a6a436 → 9088656 → c845dc3 → 970e262 → dbf4f1d → (이번 커밋)
