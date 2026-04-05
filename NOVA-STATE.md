# Nova State

## Current
- **Goal**: Goal → Structured Spec 자동 생성 기능 (ManyFast 인사이트 이식)
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| DB 스키마 + 타입 + API | done | PASS | goal_specs 테이블, GoalSpec 타입, CRUD 엔드포인트 |
| AI 스펙 생성 + 오케스트레이션 통합 | done | PASS | fire-and-forget 생성, decomposeGoal에 스펙 컨텍스트 주입 |
| 대시보드 UI (스펙 뷰어 + 트리 뷰) | done | PASS | GoalSpecPanel, 플로우 시각화, 인라인 편집, AI Refine |
| 빌드 검증 + 통합 테스트 | done | PASS | tsc + build + curl 9개 테스트 ALL PASS |
| 스펙→구현 갭 분석 실전 검증 | done | PASS | Bookmark API 스펙 12개 항목 100% 구현, 갭 0건 |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| Structured Spec 기능 | 2026-04-06 | PASS | 12파일 +1372줄, 0d8d4ea |
| 워크트리 격리 + 포트 + UX | 2026-04-06 | PASS | 18파일 변경, c992a1d |
| 방어로직 전면 강화 (55+건) | 2026-04-05 | PASS | 14커밋 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| npm publish | npmjs.com 미배포 | Low |
| 동시 verification 충돌 | 경고 로그만 추가, 세션 격리는 미구현 | Medium |
| 대시보드 오프라인 모드 | WS 끊김 시 캐시 표시 없음 | Low |
| Spec → Decompose 자동 연계 | 스펙 생성 후 자동 분해 트리거 미구현 | Medium |

## Key Changes This Session
- `shared/types.ts` — GoalSpec 타입 정의 (PRD, 기능명세, 유저플로우, 수락기준)
- `server/db/schema.ts` — goal_specs 테이블 + 인덱스 마이그레이션
- `server/api/routes/goals.ts` — GET/PATCH/POST 스펙 API + AI Refine 엔드포인트
- `server/api/routes/orchestration.ts` — generateGoalSpec (fire-and-forget) + refineGoalSpec
- `server/core/orchestration/engine.ts` — decomposeGoal에 스펙 컨텍스트 자동 주입
- `server/index.ts` — AppContext에 generateGoalSpec 추가
- `dashboard/src/components/GoalSpecPanel.tsx` — 대형 모달, 5-섹션 네비, 플로우 시각화, 인라인 편집, AI Refine
- `dashboard/src/components/ProjectHome.tsx` — Goals "?" 가이드 툴팁 + View Spec 버튼
- `dashboard/src/lib/api.ts` — getSpec, updateSpec, generateSpec, refineSpec
- `dashboard/src/i18n/en.ts` + `ko.ts` — 스펙 관련 i18n 키 30+개
- `dashboard/src/stores/useStore.ts` — Project.dev_port 타입 수정 (기존 빌드 에러 해결)

## Last Activity
- Goal → Structured Spec 기능 구현 + 실전 갭 검증 완료 | 2026-04-06

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Design: docs/designs/phase2-production-ready.md
- Last Verification: tsc PASS + build PASS + 통합테스트 9/9 PASS + 갭분석 12/12 PASS
