# Nova State

## Current
- **Goal**: 전체 버그 헌트 + 수정 스프린트 (Critical/High/Medium/Low 25+개)
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| 동시 세션 충돌 해결 | done | PASS | sessionKey 분리, keyToAgentId 매핑 |
| Full autopilot 순차 파이프라인 | done | PASS | processNextGoal — 우선순위 순 1개씩 |
| 목표 처리 ↔ 태스크 실행 분리 | done | PASS | triggerGoalProcessingIfNeeded 비차단 |
| 토스트 시스템 스택형 개편 | done | PASS | useToast store, 에러 persistent + detail |
| 에이전트 활동 가시성 | done | PASS | current_activity 컬럼 + i18n 키 형식 |
| autopilot 모드 승인/반려 숨김 | done | PASS | Auto 배지로 대체 |
| AI 목표 추천 기능 | done | PASS | AddGoalDialog 3-mode (직접/기획서/추천) |
| 기획서 생성 상태 영속화 | done | PASS | spec_status API + 새로고침 시 폴링 복원 |
| Decompose fire-and-forget | done | PASS | 502 타임아웃 해결 |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| 전체 버그 헌트 + 수정 (Critical 4 / High 6 / Medium 8 / Low 2) | 2026-04-08 | PASS | tsc+빌드 통과, 15파일 |
| Full Autopilot 안정화 + UX 대폭 개선 | 2026-04-08 | PASS | 15+파일, 세션/큐/UX 전반 |
| Orbit UX 6개 개선 | 2026-04-06 | PASS | 15파일, +450줄 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| Rate limit 모달 | 진짜 rate limit일 때 전체 딤 모달 (현재는 활동 로그만) | Medium |
| Stream parser 견고성 | 빈 stdout/empty assistant 케이스 더 많은 로깅 | Low |
| Goal 의존성 | depends_on_goal_id 미구현 (현재는 priority만) | Low |
| 비개발자 UX Phase 2 | Git 설정 단순화, 검증 시각화 | Medium |
| npm publish | npmjs.com 미배포 | Low |

## Key Changes This Session
- `server/core/agent/session.ts` — sessionKey 옵션 추가, keyToAgentId 매핑
- `server/core/orchestration/scheduler.ts` — processNextGoal 순차 파이프라인, triggerGoalProcessingIfNeeded 비차단, fullAutopilotLock
- `server/core/orchestration/engine.ts` — sessionKey 사용 (decompose, mission), current_activity 업데이트, stream-parser 디버깅
- `server/core/agent/adapters/stream-parser.ts` — content_block_delta 등 추가 이벤트 타입, rate_limit_event 감지
- `server/api/routes/goals.ts` — POST /goals/suggest (AI 추천), spec_status 필드, autopilot에서 spec→decompose 체인
- `server/api/routes/orchestration.ts` — decompose fire-and-forget (202), current_activity 설정
- `server/db/schema.ts` — agents.current_activity 컬럼 추가
- `dashboard/src/stores/useToast.ts` — 새 전역 토스트 스택 store
- `dashboard/src/components/Toast.tsx` — ToastContainer + 레거시 브릿지, 에러 persistent + 상세 접기
- `dashboard/src/components/ProjectHome.tsx` — AddGoalDialog 3-mode(직접/기획서/AI추천), 폴링 복원, autopilotMode 전달
- `dashboard/src/components/OrgChart.tsx` — parseActivity 헬퍼 (i18n 키 → 번역), 활동 표시
- `dashboard/src/components/AgentDetail.tsx` — current_activity 표시
- `dashboard/src/components/TaskList.tsx` — autopilot 시 승인/반려 숨김 → Auto 배지
- `dashboard/src/components/GoalSpecPanel.tsx` — onGeneratingClose 콜백 (모달 닫아도 폴링 유지)
- `dashboard/src/lib/api.ts` — error.status/detail 필드, suggest API
- `dashboard/vite.config.ts` — proxy timeout 5min
- `dashboard/src/i18n/{ko,en}.ts` — 활동/토스트/추천 관련 키 다수

## Last Activity
- 버그 헌트 스프린트 완료: Critical(verification guard, path traversal, mission JSON partial) + High(delegated parent verify, progress race, 입력 제한, assignee hang, WS auth, sessions row) + Medium(JSON parse, PATCH/DELETE txn, resumeQueue, signal info, merge-all safety) + Low(POLL_INTERVAL 단축) | 2026-04-08

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Last Verification: tsc PASS (server + dashboard)
</content>
</invoke>