# Nova State

## Current
- **Goal**: Nova Orbit v0.1.0 — 전체 기능 구현 + 안정화 완료
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| Phase 0.5 스캐폴드 | done | PASS | 서버+DB+API+어댑터 |
| Phase 1 전체 기능 | done | PASS | 태스크실행/임포트/검증/거버넌스/큐 |
| Phase 2 UX | done | PASS | Kanban/다크모드/i18n/Cmd+K/아바타/알림 |
| 안정성 수정 | done | PASS | WS에러핸들링/타임아웃/좀비프로세스/Hooks순서 |
| 사용성 개선 | done | PASS | 가이드/분해UX/큐상태/Activity포맷/2단계에이전트추가 |
| 비용 추적 | done | PASS | token/cost 파싱+대시보드표시 |
| E2E Playwright 테스트 | done | PASS | Todo App 전체 흐름 검증 |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| 에이전트 삭제/프롬프트편집/2단계추가 | 2026-04-04 | PASS | 55커밋 |
| 비용 추적 (token/cost) | 2026-04-04 | PASS | stream-json 파싱 |
| 서버 안정성 (5분 타임아웃, WS 에러) | 2026-04-04 | PASS | stuck 에이전트 방지 |

## Known Risks
| Risk | Severity | Status |
|------|----------|--------|
| Claude Pro 동시 세션 rate limit 미실측 | Warning | 미해결 |
| API 인증 없음 (localhost 바인딩으로 완화) | Warning | 완화됨 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| npm publish | npmjs.com 미배포 | Medium |
| 자동화 E2E 테스트 | Playwright CI 파이프라인 미구성 | Medium |
| 실시간 터미널 로그 | 에이전트 출력이 터미널처럼 보이면 좋겠다는 피드백 | Low |

## Last Activity
- 에이전트 삭제+2단계추가+비용추적+안정성 — 55커밋 | 2026-04-04T10:00:00Z

## Refs
- Plan: docs/PROJECT.md
- Design: docs/KICKOFF.md
- Evaluator: docs/EVALUATOR.md
- Figma: https://www.figma.com/design/oYV8Yp8DvntGwWi2kxnrGi
- Last Verification: Nova Review PASS + vitest 44/44 PASS
