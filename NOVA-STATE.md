# Nova State

## Current
- **Goal**: Nova 규칙 통합 엔진 — 패턴 이식에서 진짜 하네스 엔지니어링으로
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
| Nova 규칙 통합 엔진 | 2026-04-06 | PASS | 12파일 +1036줄, a0329c6 |
| Structured Spec 기능 | 2026-04-06 | PASS | 12파일 +1372줄, 0d8d4ea |
| 워크트리 격리 + 포트 + UX | 2026-04-06 | PASS | 18파일 변경, c992a1d |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| Nova 런타임 연동 | MCP 직접 호출 미구현 (프롬프트 주입만) | Medium |
| Layer 3 실행 강제 | 프롬프트 지시만, 실제 실행 여부 검증 수단 없음 | Medium |
| npm publish | npmjs.com 미배포 | Low |
| 동시 verification 충돌 | 경고 로그만, 세션 격리 미구현 | Medium |
| Spec → Decompose 자동 연계 | 스펙 생성 후 자동 분해 트리거 미구현 | Medium |

## Key Changes This Session
- `server/core/nova-rules/index.ts` — Nova Rules Engine (빌드 타임 동기화 + 런타임 로드)
- `server/core/nova-rules/*.md` — Nova 핵심 규칙 3종 (rules, evaluator, orchestrator)
- `server/core/quality-gate/evaluator.ts` — verdict 보정 제거, Nova 3-Layer 프로토콜, CONDITIONAL, autoDetectScope()
- `server/core/orchestration/engine.ts` — Architect Phase, detectComplexity(), 구현 프롬프트 강화
- `server/index.ts` — /api/nova-rules/version + /api/nova-rules/sync 엔드포인트
- `scripts/sync-nova-rules.sh` — Nova→Orbit 빌드 타임 동기화 스크립트
- `scripts/predev.sh` — dev 시작 시 Nova 버전 자동 감지 + 동기화
- `dashboard/src/components/StatusBar.tsx` — Nova 버전 표시 + outdated sync 버튼
- `dashboard/index.html` — 화이트모드 기본값

## Last Activity
- Nova 규칙 통합 엔진 구현 + 적대적 갭 분석 6건 해결 | 2026-04-06

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Gap Analysis: 적대적 평가 12항목 (FAIL×6 → 전부 해결, Known Gaps 2건 이월)
- Last Verification: tsc PASS + build PASS + 서버 기동 + API curl 3종 PASS
