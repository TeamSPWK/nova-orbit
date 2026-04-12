# Nova State

## Current
- **Goal**: Pulsar v2 하이브리드 마케팅 오케스트레이터 + Nova Orbit 오케스트레이션 개선
- **Phase**: Pulsar v1 목표 완료, v2 기획 전달 완료, Nova Orbit 개선 커밋 완료
- **Blocker**: none

## Tasks (이번 세션 — 2026-04-11~12)

### Nova Orbit 오케스트레이션 개선
| Task | Status | Note |
|------|--------|------|
| rescuePendingGoals auto-approve 누락 수정 | done | Goal/Full 모드에서 태스크 stuck 방지 |
| startQueue pending_approval 자동 승인 | done | 서버 재시작 후 stuck 방지 |
| 태스크 정렬 버그 수정 | done | done이 활성 태스크를 밀어내는 문제 — status 우선순위 정렬 |
| 완료 목표 판정 수정 | done | 태스크 0개 + progress 100% → 완료로 분류 |
| 목표 순서 leapfrog 방지 | done | 진행 중 목표가 있으면 높은 priority도 대기 |
| 자동 건너뜀 FAIL 메시지 UI 수정 | done | done 태스크에서 block reason 미표시 |
| NOVA_NO_AUTO_QUEUE 하드코딩 제거 | done | dev 모드에서도 큐 자동 시작 |
| 태스크 유형별 검증 (task_type) | done | code/content/config/review 4분기, scope mismatch 오탐 제거 |
| 적응형 동시성 AIMD | done | rate limit 시 동시성 절반, 성공 시 +1 복원 |
| 태스크 의존성 그래프 DAG | done | depends_on 필드, decompose 시 태깅, pickNextTasks 필터 |
| decompose 자동 재시도 | done | 실패 시 최대 2회, 60s/120s 백오프 |
| decompose 프롬프트 간결화 | done | JSON truncation 방지, max 100 words/task |
| AIMD 타이머 충돌 수정 | done | backoff 중 pause=true + 이전 타이머 취소 |
| Rate limit UX 개선 (5인 UX Audit) | done | 모달→인라인 배너, Toast 5초, aria-live, 중립 톤 |

### Pulsar 마케팅 전략 전환
| Task | Status | Note |
|------|--------|------|
| Pulsar 현재 상태 분석 | done | UI 75%, 백엔드 90%, 전부 dry_run, fixture 데이터 |
| 미션 변경 (개발→실행 중심) | done | "ZipPit 실제 발행 + 유입 100회" |
| 목표 7개 등록 + 전부 완료 | done | Ghost 발행, 파이프라인, 대시보드, SEO, 유입추적, 카드뉴스, 뉴스레터 |
| 국내 마케팅 채널 조사 | done | Ghost 국내 비효과, 네이버/티스토리/커뮤니티 중심 전환 |
| 3인 다관점 자문 (/nova:consult) | done | Strong Consensus: 도구형+커뮤니티 시딩 > 블로그 |
| v2 기획서 작성 | done | docs/plans/plan-v2-hybrid-orchestrator.md |
| v2 미션+목표 5개 등록 | done | 수동태스크보드, 주간플랜, 티스토리, 커뮤니티인텔, 성과추적 |
| pipeline.py SyntaxError 수정 | done | 2996줄 줄바꿈 `\` 누락 |
| Pulsar 로컬 실행 검증 (Playwright) | done | 대시보드+API+Ghost+Redis 기동 확인 |

## Recently Done (max 3)
| Task | Completed | Ref |
|------|-----------|-----|
| Nova Orbit 오케스트레이션 3대 개선 + 버그 14건 | 2026-04-12 | `355087f`, `47284a8`, `41e1547` |
| Pulsar v1 목표 7개 전부 완료 + v2 기획 전달 | 2026-04-12 | 미션 전환, 5개 신규 목표 |
| 스케줄러 안정화 + UX 개선 (7 commits) | 2026-04-11 | 이전 세션 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| DAG 순환 의존성 방지 | decompose 시 순환 감지 로직 미구현 — 수동 DB 수정으로 임시 해결 | **High** |
| AIMD 쿨다운 후 resume 검증 | 타이머 충돌 수정했으나 장시간 운영 시 재현 테스트 필요 | Medium |
| Pulsar fixture 데이터 | analytics.yaml의 seed fixture가 아직 집계에 포함됨 — v2 목표에 포함 | Medium |
| 에이전트 파일 편집 UI | .claude/agents/ 읽기 전용. 편집 미구현 | Low |
| npm publish | npmjs.com 미배포 | Low |

## Key Architecture Changes

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
- Pulsar v2 기획서 작성 + 미션/목표 전달, AIMD 타이머 버그 수정 | 2026-04-12T22:55:00+09:00
