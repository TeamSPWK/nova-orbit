# Nova State

## Current
- **Goal**: 오케스트레이션 프로세스 개선 — 태스크 독립 배포 단위 취급 근본 원인 해결
- **Phase**: Goal-as-Unit 백엔드 + Quality Gate Phase 3 완료 (Dashboard UI 후속)
- **Blocker**: none

## Tasks (이번 세션 — 2026-04-21)

### 오케스트레이션 프로세스 개선 (3 phase)
| Phase | Status | Note |
|-------|--------|------|
| Phase 1 — 동시성 기본값 3→1 | done | wall-clock 보다 맥락 일관성 우선 |
| Phase 2-A — Goal-as-Unit 설계 (CPS) | done | docs/design/goal-as-unit.md |
| Phase 2-B — 백엔드 구현 | done | schema/worktree/git/engine/api 7파일 |
| Phase 2-C — Evaluator + Fix | done | CONDITIONAL → Fix(H-1/H-2/H-3/M-3) → PASS |
| Phase 3-A — Quality Gate 설계 | done | docs/design/quality-gate-phase3.md |
| Phase 3-B — Adversarial + QA 회귀 구현 | done | engine.ts 확장 + 마이그레이션 |
| Phase 3-C — Evaluator + Fix | done | CONDITIONAL → Fix(C-1/C-2/H-2) → PASS |

## Recently Done (max 3)
| Task | Completed | Ref |
|------|-----------|-----|
| 오케스트레이션 프로세스 개선 3 phase | 2026-04-21 | `3698892`, `454dcfa`, `d94e325`, `92eea62`, `1984f68`, `7414d1c` |
| markwand drift 기능 goal 100% + 대응 수습 | 2026-04-20 | `f17bb1c` 외 13커밋 (markwand repo) |
| delegation 서브태스크 중복 생성 방지 | 2026-04-14 | `540a92f` |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| Goal-as-Unit 대시보드 UI | squash 승인 버튼 / acceptance_script 입력 / QA 회귀 상태 표시 | **High** |
| Goal-as-Unit E2E 런타임 검증 | 실제 agent 로 1 goal decompose→worktree→stash→squash 관통 테스트 | **High** |
| QA 회귀 태스크 실행 능력 | 에이전트가 "앱 실행 + UI 클릭 + diff 리뷰" 를 실제로 수행할지 불확실 | High |
| Adversarial 주입 UI 옵션 | skip_adversarial 플래그 + decompose 결과 거부 경로 | Medium |
| triggerGoalSquash race (concurrency>1) | `DEFAULT_MAX_CONCURRENCY=1` 기본값 전제 — 사용자 override 시 트랜잭션 필요 | Medium |
| main 외 baseBranch 프로젝트 | `git diff main...HEAD` 하드코드, develop/master 프로젝트 미지원 | Medium |
| `gh pr create --squash` 검증 | branch_pr 모드 실제 CLI 옵션 미확인 | Low |
| goalSlug 유일성 | title 40자 동일 시 edge-cases.md 덮어쓰기 | Low |
| DAG 순환 의존성 방지 | decompose 시 순환 감지 로직 미구현 | High |
| AIMD 쿨다운 후 resume 검증 | 장시간 운영 시 재현 테스트 필요 | Medium |

## Key Architecture Changes

### Goal-as-Unit 아키텍처 (2026-04-21)
- **Before**: Task-per-worktree, 태스크 단위 commit → goal 당 N개 커밋 파편화
- **After**: Goal-per-worktree, 태스크 완료 시 WIP 유지, goal 완료 시 **1 squash commit**
- 신규 컬럼: `goals.goal_model`('legacy'|'goal_as_unit'), `worktree_path`, `worktree_branch`, `acceptance_script`, `squash_commit_sha`, `squash_status`, `qa_regression_task_id`
- 호환성: 기존 goal 은 'legacy' 유지, 신규 decompose 시점에 'goal_as_unit' 자동 승격
- 재시작 복구: `recoverOnStartup()` 이 active goal worktree 제외 + `pending_approval` 재broadcast

### 태스크 체크포인트 (2026-04-21)
- 태스크 시작 전 `git stash push -m "nova-checkpoint-{taskId}"`
- 실패 시 restoreCheckpoint — 해당 태스크만 롤백, goal 전체 보존
- 충돌 시 `checkout -- .` + `stash drop` + blocked 전환

### Squash Merge + 사용자 승인 (2026-04-21)
- Goal 완료 감지 → QA 회귀 태스크 생성 대기 → acceptance_script → `pending_approval`
- 대시보드 승인 클릭 → `squashMergeGoal()` 모드별 (local_only/main_direct/pr) → 1 커밋

### Adversarial Task 자동 주입 (2026-04-21)
- Goal title/description 에 감지/분석/추출/파싱/detect/parse/extract/analyze/validate/match/find/scan 키워드 포함 + 50자 이상 시
- `[사전 조사] 실세계 실패 패턴 10가지 수집` 태스크를 order=1 로 prepend
- MAX_TASKS_PER_GOAL 꽉 찬 경우 low-priority 태스크 drop 후 depends_on 재정리

### QA 회귀 태스크 자동 생성 (2026-04-21)
- Goal 모든 태스크 완료 시 triggerGoalSquash 첫 호출 → QA 회귀 태스크 1개 생성 (idempotent)
- 내용: "앱 실행 + 전체 diff 리뷰 + 기존 기능 회귀 체크"
- assignee fallback: qa → reviewer → qa*/test* → coder → non-cto → any
- QA done 돼야 실제 squash 진입

### 동시 실행 기본값 3→1 (2026-04-21)
- Solo founder 워크플로우 — 품질 > wall-clock
- 병렬 실행이 선행 태스크 output 을 못 받아 false-positive 파생 (drift 사례)
- `NOVA_MAX_CONCURRENCY` env 로 override 가능

### delegation 중복 방지 가드 (2026-04-14)
- **원인**: 부모 태스크 blocked→stale→todo 리셋 시 attemptDelegation() 재호출 → 동일 서브태스크 무한 생성
- **수정**: delegation.ts에 `SELECT COUNT(*) FROM tasks WHERE parent_task_id = ?` 가드 추가

### 오케스트레이션 3대 개선 (2026-04-12)
1. **태스크 유형별 검증**: task_type(code/content/config/review) 컬럼 + evaluator 4분기 프롬프트
2. **적응형 동시성 AIMD**: rate limit 1~2회 → 동시성 절반, 성공 시 +1, 3회 → 15분 쿨다운
3. **태스크 의존성 그래프**: depends_on 컬럼, decompose 시 order→ID 매핑, pickNextTasks DAG 필터

## Last Activity
- /nova:orchestrator → PASS — 오케스트레이션 프로세스 개선 3 phase 완료 (6 커밋) | 2026-04-21T02:17+09:00
- context compacted | 2026-04-21T01:21:19Z
- delegation 서브태스크 중복 생성 버그 수정 + zippit 데이터 정리 | 2026-04-14T22:48:00+09:00
