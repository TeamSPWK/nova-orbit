# Nova State

## Current
- **Goal**: Nova Orbit v0.2.0 — Autopilot + Hierarchical Delegation + 병렬 실행
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| Autopilot 3단계 (off/goal/full) | done | PASS | Goal모드: 자동분해+실행, Full모드: mission→Goal생성+자동전환 |
| Rate Limit 복원력 | done | PASS | Queue pause+backoff(60→120→240s)+3회정지+수동재개 |
| Hierarchical Delegation | done | PASS | 2뎁스→3뎁스 위임, 서브태스크5개상한, depth1제한 |
| 병렬 스케줄러 | done | PASS | 에이전트별1태스크, max3동시, busyAgents추적 |
| TaskTimeline 패널 | done | PASS | AgentChatLog→이벤트타임라인, 복수태스크동시표시 |
| AutopilotModal | done | PASS | 3단계선택모달, Full전제조건체크, 안전장치안내 |
| QA 버그수정 (8건) | done | PASS | TDZ/sessionLeak/nullAssignee/conditionalVerdict 등 |
| Nova Review 이슈수정 (6건) | done | PASS | SQL보간→바인딩/transitionTask중앙화/서브태스크검증스킵 |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| Autopilot + Delegation 전체 구현 | 2026-04-05 | PASS | 18파일+1138줄, 22테스트 |
| QA 버그 8건 수정 | 2026-04-05 | PASS | 엔진/스케줄러/평가기 핵심경로 |
| Nova Review C3+W2+I1 수정 | 2026-04-05 | PASS | 세션leak/상태중앙화/테스트추가 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| npm publish | npmjs.com 미배포 | Low |
| 서브태스크 병렬 실행 | 현재 직렬만, 에이전트별 병렬은 Phase 2 | Low |
| Delegation depth 확장 | 현재 1단계만 (2→3뎁스), 다단계는 Phase 2 | Low |
| API 페이지네이션 | 서버 API limit/offset 미구현 | Medium |
| Full Autopilot 비용 추적 | Goal별 누적 비용 표시 미구현 | Medium |

## Last Activity
- /nova:review → PASS — Autopilot+Delegation 전체 (18파일) | 2026-04-05T13:35:00+09:00

## Refs
- Plan: docs/PROJECT.md
- Design: docs/designs/autopilot-hierarchical-delegation.md
- Last Verification: tsc PASS + build PASS + vitest 22/22 PASS + API curl 검증 PASS
