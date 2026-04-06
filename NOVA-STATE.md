# Nova State

## Current
- **Goal**: 비개발자 친화 UX 개선 — 용어 교체 Phase 1
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| 적대적 갭 분석 (Nova vs Orbit) | done | FAIL×6 PASS×5 | 6개 핵심 문제 발견 |
| Critical 버그 수정 (verdict 보정) | done | PASS | avg>=6 FAIL→PASS 오버라이드 제거 |
| Nova Rules Engine 구축 | done | PASS | 빌드 타임 동기화, 런타임 로드 |
| Evaluator Nova 프로토콜 주입 | done | PASS | 3-Layer, CONDITIONAL, scope별 분리 |
| Architect Phase + 복잡도 라우팅 | done | PASS | moderate/complex → CPS 설계 |
| 대시보드 Nova 버전 표시 + sync | done | PASS | API + StatusBar + predev 자동 감지 |
| 화이트모드 기본값 | done | PASS | index.html |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| 기획서 생성 세션 충돌 수정 | 2026-04-06 | PASS | 4파일, ef21ddc |
| 비개발자 친화 용어 교체 Phase 1 | 2026-04-06 | PASS | 3파일, 759395a |
| Nova 규칙 통합 엔진 | 2026-04-06 | PASS | 12파일 +1036줄, a0329c6 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| Nova 런타임 연동 | MCP 직접 호출 미구현 (프롬프트 주입만) | Medium |
| Layer 3 실행 강제 | 프롬프트 지시만, 실제 실행 여부 검증 수단 없음 | Medium |
| npm publish | npmjs.com 미배포 | Low |
| 동시 verification 충돌 | 경고 로그만, 세션 격리 미구현 | Medium |
| Spec → Decompose 자동 연계 | ~~미구현~~ → ef21ddc에서 구현 완료 | Done |
| 비개발자 UX Phase 2 | UX 구조 개선 — Git 설정 단순화, 검증 시각화, 간소화 뷰 | Medium |
| 비개발자 UX Phase 3 | 비개발자 전용 경험 — 터미널 숨김, 진행률 중심 뷰 | Low |

## Key Changes This Session
- `server/api/routes/goals.ts` — withSpec 플래그로 autopilot decompose 지연, spec 완료 후 자동 트리거
- `server/api/routes/orchestration.ts` — CLI exit code 검증 + JSON 추출 fallback
- `server/core/agent/adapters/stream-parser.ts` — result 이벤트 텍스트 덮어쓰기 방지
- `dashboard/src/components/ProjectHome.tsx` — withSpec: true 전달

## Last Activity
- 기획서 생성 시 autopilot decompose 세션 충돌 해결 (ef21ddc) | 2026-04-06

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Gap Analysis: 적대적 평가 12항목 (FAIL×6 → 전부 해결, Known Gaps 2건 이월)
- Last Verification: tsc PASS + build PASS (ef21ddc)
