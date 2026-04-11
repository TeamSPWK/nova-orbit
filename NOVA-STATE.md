# Nova State

## Current
- **Goal**: 스케줄러 안정화 + 대시보드 UX 개선
- **Phase**: done (12 commits)
- **Blocker**: none

## Tasks (이번 세션 — 2026-04-11)
| Task | Status | Note |
|------|--------|------|
| zippit retry 루프 조사 + 세션 kill | done | 21개 세션 폭발 원인 분석 |
| 스케줄러 retry 방어 4건 | done | 지수 백오프, 회로 차단기, ghost cleanup, shouldAutoStop |
| rescue 순차 처리 | done | 병렬 spec 생성 방지, activeGoal 가드, progress 갱신 |
| 영구 blocked 자동 해결 | done | autoResolvePermanentlyBlocked → done(skipped) |
| blocked 사유 UX + 가이드 문서 | done | verification_issues, 건너뜀 뱃지, docs/GUIDE.md |
| /nova:review → UX 10건 | done | C-1~C-3 + W-1~W-7, 프로덕션 빌드 PASS |
| 5인 적대적 UX 평가 → 15건 도출 | done | 온보딩/PM/파워유저/보안/경쟁분석 |
| S1: Critical 성능 + 보안 | done | API LIMIT, O(N×M) Map, auth key 1회, rate limiter |
| S2: 비개발자 용어 + 온보딩 | done | Autopilot 한국어, severity 번역, 시작 가이드, toast i18n |
| S3: 검색 + 잔여 태스크 + WS 보안 | done | 목표 검색, N개 남음, WS auth 메시지 방식 |
| S4: 실시간 파일명 + 메트릭 + 에이전트 파일 | done | stream-json 파싱, 통과율 API/UI, .claude/agents 표시 |

## Recently Done (max 3)
| Task | Completed | Ref |
|------|-----------|-----|
| 스케줄러 안정화 + UX 개선 (7 commits) | 2026-04-11 | `3c447a4`→`7e703be` |
| 오케스트레이션 엔진 안정화 (25+ 이슈) | 2026-04-10 | `1dc62b5`→`41e47f0` (9 commits) |
| Nova Orbit UX/안정성 대규모 개선 (21 commits) | 2026-04-10 | 이전 세션 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| 에이전트 파일 편집 UI | .claude/agents/ 파일 읽기 전용 표시 완료. 편집(쓰기) 기능은 미구현 | Low |
| 에이전트 로그 과거 복원 | 새로고침 시 이전 실행 로그 사라짐 (DB/localStorage 캐싱 없음) | Low |
| 3단계 팀 리더 위임 | FE 리더 → 팀원 위임 구조 (delegation.ts 확장) | Low |
| Subtask verification | parent verification에 git diff 통합 | Medium |
| Goal 의존성 | depends_on_goal_id 미구현 | Low |
| npm publish | npmjs.com 미배포 | Low |
| activities CASCADE | 프로젝트 삭제 시 activities 고아 레코드 가능 (현재 audit trail 보존) | Low |
| dev_port 잔여 컬럼 | Dev Server 기능 제거했으나 SQLite dev_port 컬럼은 잔존 (무해, NULL) | Low |

## Key Architecture Changes

### 스케줄러 retry 방어 체계 (2026-04-11)
1. **회로 차단기**: 연속 2회 동일 검증 실패 시 시그니처 비교 → 즉시 영구 blocked
2. **지수 백오프**: retry level별 쿨다운 (10s × 2^level), reassign은 40s
3. **ghost cleanup 한도 체크**: retry/reassign 소진된 stale 태스크는 todo가 아닌 blocked로 전이
4. **shouldAutoStop 보완**: in_review 포함 + 단일 에이전트 시 reassign 예산 소진

### 중복 태스크 방지 3층 방어 (2026-04-10)
1. **decomposeGoal 근본 가드**: 기존 태스크 존재 시 taskCount=0 반환, AI 세션 spawn 방지
2. **processNextGoal 이중 방어**: decompose 전 count 체크 + auto-approve를 decompose 분기 안으로
3. **6개 호출 경로 전부 보호**: triggerAutopilotDecompose, rescuePendingGoals, triggerFullAutopilot 등

### 개발 모드 토큰 절약 (2026-04-10)
- `NOVA_NO_AUTO_QUEUE=true` 환경변수 → dev:server에 기본 적용

## Last Activity
- Dev Server 기능 전체 제거 (9파일), 고아 브랜치 정리 기본값 변경, 목표 카드 overflow 수정 | 2026-04-11T21:30:00+09:00

## Refs
- Session commits: `3c447a4` → `1405646` → `ae690c0` → `6d00535` → `e478141` → `7e703be` → `1e09156` → `e42539f` → `1fa360d` → `2d8cfeb` → `b31cefa` → `bd0a3fd`
- Last Verification: tsc (server+dashboard) PASS, npm run build PASS
