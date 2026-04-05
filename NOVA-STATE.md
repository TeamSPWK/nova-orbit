# Nova State

## Current
- **Goal**: 워크트리 격리 버그 수정 + 포트 설정 + UX 개선
- **Phase**: done
- **Blocker**: none

## Tasks
| Task | Status | Verdict | Note |
|------|--------|---------|------|
| 워크트리 격리 문제 해결 | done | PASS | needs_worktree 컬럼, reviewer/qa 프로젝트 루트 실행, 모든 모드 main 머지 |
| 서버 포트 3000→7200 | done | PASS | bin, server, vite, predev, package.json 일괄 변경 |
| 프로젝트 dev server 포트 설정 | done | PASS | dev_port 컬럼, force kill 옵션, 예약포트 보호, UI 추가 |
| StatusBar ctx 제거 | done | PASS | context window % 표시 제거, 5h/토큰/비용 유지 |
| 직접 프롬프트 컨텍스트 강화 | done | PASS | Goal+Task 상태를 org context에 주입, curl 검증 완료 |
| Git Workflow 모드 버그 수정 | done | PASS | github_config→github 변환 (toProjectResponse) |
| 태스크 정렬 내림차순 | done | PASS | ORDER BY created_at DESC |

## Recently Done (max 3)
| Task | Completed | Verdict | Ref |
|------|-----------|---------|-----|
| 워크트리 격리 + 포트 + UX | 2026-04-06 | PASS | 18파일 변경, c992a1d |
| 방어로직 전면 강화 (55+건) | 2026-04-05 | PASS | 14커밋 |
| 실시간 UX (출력 파싱+펼침) | 2026-04-05 | PASS | agentOutputParser.ts |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| npm publish | npmjs.com 미배포 | Low |
| 동시 verification 충돌 | 경고 로그만 추가, 세션 격리는 미구현 | Medium |
| 대시보드 오프라인 모드 | WS 끊김 시 캐시 표시 없음 | Low |

## Key Changes This Session
- `server/db/schema.ts` — agents.needs_worktree 컬럼 + projects.dev_port 컬럼
- `server/core/orchestration/engine.ts` — needs_worktree=0이면 워크트리 스킵, 모든 모드에서 main 머지
- `server/core/project/git-workflow.ts` — mergeBranchSequential (동시 머지 방어)
- `server/core/project/worktree.ts` — HEAD 존재 여부 방어 로직
- `server/core/project/dev-server.ts` — 포트 검증, 예약포트 보호, force kill 지원
- `server/api/routes/projects.ts` — toProjectResponse (github_config→github 변환)
- `server/api/routes/orchestration.ts` — 직접 프롬프트에 Goal/Task 컨텍스트 주입
- 서버 기본 포트 3000→7200 (bin, server, vite, package.json, predev.sh)
- 대시보드: 워크트리 토글 UI, dev port 설정 UI

## Last Activity
- 워크트리 격리 버그 수정 + 포트 설정 + UX 다수 개선 | 2026-04-06

## Refs
- Plan: docs/plans/phase2-production-ready.md
- Design: docs/designs/phase2-production-ready.md
- Last Verification: tsc PASS + build PASS (server + dashboard)
