# Nova State

## Current
- **Goal**: 스케줄러 안정화 + 대시보드 UX 개선
- **Phase**: done (7 commits)
- **Blocker**: none
- **Next**: W-1(Toast 에러 피드백), W-3(목표 카드 버튼 정리), W-5(빈 상태 CTA), W-6(ARIA 접근성)

## Tasks (이번 세션 — 2026-04-11)
| Task | Status | Note |
|------|--------|------|
| zippit retry 루프 조사 + 세션 kill | done | 21개 세션 폭발 원인 분석 |
| 스케줄러 retry 방어 4건 | done | 지수 백오프, 회로 차단기, ghost cleanup, shouldAutoStop |
| rescue 순차 처리 | done | 병렬 spec 생성 방지, activeGoal 가드, progress 갱신 |
| 영구 blocked 자동 해결 | done | autoResolvePermanentlyBlocked → done(skipped) |
| blocked 사유 UX | done | verification_issues API 추가, 건너뜀 뱃지 |
| 전체 플로우 가이드 문서 | done | docs/GUIDE.md (14 섹션) |
| /nova:review → UX 10건 수정 | done | C-1~C-3 + W-2,W-4,W-7 수정, 프로덕션 빌드 PASS |

## Recently Done (max 3)
| Task | Completed | Ref |
|------|-----------|-----|
| 스케줄러 안정화 + UX 개선 (7 commits) | 2026-04-11 | `3c447a4`→`7e703be` |
| 오케스트레이션 엔진 안정화 (25+ 이슈) | 2026-04-10 | `1dc62b5`→`41e47f0` (9 commits) |
| Nova Orbit UX/안정성 대규모 개선 (21 commits) | 2026-04-10 | 이전 세션 |

## Known Gaps
| Area | Uncovered Content | Priority |
|------|-------------------|----------|
| W-1 태스크 상태 변경 에러 피드백 | 상태 드롭다운 변경 실패 시 Toast 알림 없음 (silent catch) | High |
| W-3 목표 카드 버튼 과밀 | 5개 버튼 한 줄 밀집, "다시 분할" 위험도 미인지. ⋮ 메뉴 묶기 필요 | Medium |
| W-5 빈 상태 CTA 부재 | 목표/태스크 없을 때 다음 단계 안내 없음 | Medium |
| W-6 ARIA 접근성 | 버튼/드롭다운/스피너 aria-label 거의 없음. WCAG AA 색상 대비 미달 | Medium |
| 3단계 팀 리더 위임 | FE 리더 → 팀원 위임 구조 (delegation.ts 확장) | Low |
| Subtask verification | parent verification에 git diff 통합 | Medium |
| Goal 의존성 | depends_on_goal_id 미구현 | Low |
| npm publish | npmjs.com 미배포 | Low |
| activities CASCADE | 프로젝트 삭제 시 activities 고아 레코드 가능 (현재 audit trail 보존) | Low |

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
- /nova:review → CONDITIONAL — 대시보드 전체 UI/UX (비개발자 관점). Critical 3, Warning 7 | 2026-04-11T18:15:00+09:00

## Refs
- Session commits: `3c447a4` → `1405646` → `ae690c0` → `6d00535` → `e478141` → `7e703be`
- Last Verification: tsc (server+dashboard) PASS, npm run build PASS
