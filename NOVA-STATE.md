# Nova State

## Current
- **Goal**: Orbit UX 개선 — 목표 편집 + 프로젝트 온보딩 + 문서 참조
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| Goal title/description 분리 | done | PASS | DB 마이그레이션 + UI 분리 |
| Goal 편집 모달 | done | PASS | EditGoalDialog, 연필 아이콘 |
| Goal 참고문서 멀티 선택 | done | PASS | API /projects/:id/docs + 체크박스 UI |
| 프로젝트 온보딩 미션 자동 추출 | done | PASS | analyzer.ts, CLAUDE.md/readme에서 추출 |
| 에이전트 docs/ 자동 주입 | done | PASS | session.ts, 최대 4KB |
| 기획서 생성 시 docs 참조 | done | PASS | 선택 문서 우선 + 자동 발견, 16KB/3KB per file |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| Orbit UX 6개 개선 | 2026-04-06 | PASS | 15파일, +450줄 |
| Pulsar 프로젝트 방향 수립 | 2026-04-06 | PASS | Plan + 적대적 평가 + Orbit 미션 |
| ZipPit 제품 컨텍스트 작성 | 2026-04-06 | PASS | product.yaml + zippit-product-context.md |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| Nova 런타임 연동 | MCP 직접 호출 미구현 (프롬프트 주입만) | Medium |
| Layer 3 실행 강제 | 프롬프트 지시만, 실제 실행 여부 검증 수단 없음 | Medium |
| npm publish | npmjs.com 미배포 | Low |
| 비개발자 UX Phase 2 | Git 설정 단순화, 검증 시각화, 간소화 뷰 | Medium |
| 비개발자 UX Phase 3 | 터미널 숨김, 진행률 중심 뷰 | Low |

## Key Changes This Session
- `server/db/schema.ts` — goals에 title, references 컬럼 추가
- `server/api/routes/goals.ts` — title, references CRUD
- `server/api/routes/projects.ts` — GET /:id/docs (문서 목록 API), import 시 미션 자동 추출
- `server/api/routes/orchestration.ts` — spec 생성 시 프로젝트 docs 16KB 주입, 파일당 3KB cap
- `server/core/agent/session.ts` — 에이전트 스폰 시 docs/ 자동 주입 (4KB)
- `server/core/project/analyzer.ts` — extractMission(), detectProjectDocs()
- `dashboard/src/components/ProjectHome.tsx` — AddGoalDialog(title+desc), EditGoalDialog(편집+참고문서 체크박스), GoalCard(제목+접기/펼치기)
- `dashboard/src/i18n/ko.ts`, `en.ts` — 15+ 번역 키 추가

## Last Activity
- Orbit UX 6개 개선 완료 (Goal 편집, 문서 참조, 온보딩) + Pulsar 방향 수립 | 2026-04-06

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Pulsar Plan: /pulsar/docs/plans/plan-v1-mvp.md
- Pulsar 적대적 평가: /pulsar/docs/reviews/adversarial-evaluation-v1.md
- Last Verification: tsc PASS + build PASS (전체)
