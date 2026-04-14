# Nova State

## Current
- **Goal**: delegation 중복 생성 버그 수정 완료
- **Phase**: 버그 수정 + 데이터 정리 완료
- **Blocker**: none

## Tasks (이번 세션 — 2026-04-14)

### delegation 서브태스크 중복 생성 버그
| Task | Status | Note |
|------|--------|------|
| 근본 원인 분석 | done | attemptDelegation()에 기존 서브태스크 중복 체크 없음 |
| delegation.ts 가드 추가 | done | parent_task_id로 기존 서브태스크 존재 확인, 있으면 재분해 스킵 |
| zippit 프로젝트 중복 태스크 정리 | done | 중복 서브태스크 4개 + QA 1개 done 처리, 목표 100% 완료 |

## Recently Done (max 3)
| Task | Completed | Ref |
|------|-----------|-----|
| delegation 서브태스크 중복 생성 방지 | 2026-04-14 | `540a92f` |
| Nova Orbit 오케스트레이션 3대 개선 + 버그 14건 | 2026-04-12 | `355087f`, `47284a8`, `41e1547` |
| Pulsar v1 목표 7개 전부 완료 + v2 기획 전달 | 2026-04-12 | 미션 전환, 5개 신규 목표 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| DAG 순환 의존성 방지 | decompose 시 순환 감지 로직 미구현 — 수동 DB 수정으로 임시 해결 | **High** |
| AIMD 쿨다운 후 resume 검증 | 타이머 충돌 수정했으나 장시간 운영 시 재현 테스트 필요 | Medium |
| Pulsar fixture 데이터 | analytics.yaml의 seed fixture가 아직 집계에 포함됨 — v2 목표에 포함 | Medium |
| 에이전트 파일 편집 UI | .claude/agents/ 읽기 전용. 편집 미구현 | Low |
| npm publish | npmjs.com 미배포 | Low |

## Key Architecture Changes

### delegation 중복 방지 가드 (2026-04-14)
- **원인**: 부모 태스크 blocked→stale→todo 리셋 시 attemptDelegation() 재호출 → 동일 서브태스크 무한 생성
- **수정**: delegation.ts에 `SELECT COUNT(*) FROM tasks WHERE parent_task_id = ?` 가드 추가
- **효과**: 기존 서브태스크 있으면 재분해 스킵, in_progress 복원으로 완료 플로우 유지

### 오케스트레이션 3대 개선 (2026-04-12)
1. **태스크 유형별 검증**: task_type(code/content/config/review) 컬럼 + evaluator 4분기 프롬프트
2. **적응형 동시성 AIMD**: rate limit 1~2회 → 동시성 절반, 성공 시 +1, 3회 → 15분 쿨다운
3. **태스크 의존성 그래프**: depends_on 컬럼, decompose 시 order→ID 매핑, pickNextTasks DAG 필터

### Pulsar v2 전략 전환 (2026-04-12)
- **Before**: Ghost 블로그 자동 발행 중심
- **After**: 하이브리드 오케스트레이터 (자동 파이프라인 + 수동 태스크 보드)
- 기획서: `pulsar/docs/plans/plan-v2-hybrid-orchestrator.md`
- 핵심: 도구형 마케팅(계산기 공유) + 커뮤니티 시딩 + 국내 채널(네이버/티스토리)

### 스케줄러 retry 방어 체계 (2026-04-11)
1. 회로 차단기: 연속 2회 동일 검증 실패 시 즉시 영구 blocked
2. 지수 백오프: retry level별 쿨다운
3. ghost cleanup 한도 체크
4. shouldAutoStop 보완

## Last Activity
- delegation 서브태스크 중복 생성 버그 수정 + zippit 데이터 정리 | 2026-04-14T22:48:00+09:00
