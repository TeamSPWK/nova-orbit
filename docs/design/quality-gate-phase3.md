# Quality Gate Phase 3 — Adversarial + QA 회귀 자동 주입

작성일: 2026-04-21
선행: `docs/design/goal-as-unit.md`

---

## Context

오늘 drift 기능 구현 시 false-positive 폭발이 났던 근본 원인:
1. 구현 전에 "이 기능이 실세계에서 어떤 패턴으로 실패할 수 있는가" 를 먼저 조사하지 않음
2. 목표 완료 직전에 "앱을 실제로 실행해서 써보는" 단계가 없음

Phase 2 (Goal-as-Unit) 가 "언제 커밋하나" 를 바꿨다면, Phase 3 은 "무엇을 하면 완료로 간주하나" 를 바꾼다.

---

## Problem

### P1. 실세계 패턴 사전 조사 부재
- Decompose 로 생성되는 태스크는 모두 happy-path 구현
- 사용자 워크스페이스의 다양한 입력 패턴은 구현 후에나 발견됨
- 토큰 낭비 + 수정 루프 발생

### P2. Goal 완료 시 실전 QA 부재
- Quality Gate 는 정적 검증 (코드 읽기) 중심
- 런타임 동작 (서버 띄우기, UI 클릭, diff 리뷰) 자동화 없음
- Squash 승인 UI 는 생겼지만 사용자가 판단할 근거가 없음

---

## Solution

### S1. Adversarial Task 자동 주입 (decomposeGoal 확장)

**위치**: `server/core/orchestration/engine.ts` 의 `decomposeGoal()` 내, `safeTasks` 확정 직후 INSERT 루프 이전

**휴리스틱 트리거**:
Goal title 또는 description 에 다음 키워드 포함 시 주입:
- 한글: 감지, 분석, 추출, 파싱, 검증, 탐지, 매칭
- 영문: detect, parse, extract, analyze, validate, match, find, scan

**주입 태스크 내용**:
```
title: "[사전 조사] 실세계 실패 패턴 10가지 수집"
description: |
  이 기능이 실세계 사용자 데이터에서 실패할 수 있는 10가지 패턴을 수집하라.
  - 실제 사용자 워크스페이스 (이 프로젝트 루트 포함) 를 샘플링하여 조사
  - 각 패턴: 입력 예시 + 예상 결과 + 실패 이유
  - 결과물: docs/design/{goal-slug}-edge-cases.md 파일
role: qa | coder (qa 가 있으면 qa)
type: content
priority: high
order: 0 (기존 모든 태스크보다 먼저)
target_files: ["docs/design/{goal-slug}-edge-cases.md"]
```

**order 조정**:
- 기존 태스크들 order 를 `+1` 씩 증가
- adversarial 태스크 order=1
- 기존 task 1→2, 2→3 ...

**DB 영향**: 없음. 기존 `tasks` 테이블 재사용.

---

### S2. Goal QA 회귀 태스크 자동 생성 (triggerGoalSquash 확장)

**위치**: `server/core/orchestration/engine.ts` 의 `triggerGoalSquash()` 내 acceptance_script 실행 **이전**

**중복 방지**:
`goals` 테이블에 신규 컬럼 `qa_regression_task_id TEXT` 추가. 한 번만 생성.

**흐름**:
```
checkAndTriggerGoalSquash(goalId):
  if 남은 태스크 == 0:
    triggerGoalSquash(goalId)

triggerGoalSquash(goalId):
  goal = 조회
  if goal.qa_regression_task_id IS NULL:
    // 첫 호출 — QA 회귀 태스크 생성
    qaTaskId = createQARegressionTask(goal)
    UPDATE goals SET qa_regression_task_id = qaTaskId WHERE id = goal.id
    return  // squash 진행 안 함. QA 태스크 done 될 때까지 대기.
  else:
    qaTask = 조회(qa_regression_task_id)
    if qaTask.status != 'done':
      return  // 여전히 대기
    // QA 태스크 done → 이제 진짜 squash 프로세스 진행
    runAcceptanceScript() → broadcast("goal:squash_ready")
```

**주입 태스크 내용**:
```
title: "[실전 QA 회귀] 앱 실행 + 전체 diff 리뷰"
description: |
  Goal 완료 직전 실전 QA 회귀 테스트.
  
  수행:
  1. 이 worktree 에서 dev 서버 기동 (npm run dev 또는 동등)
  2. Goal 의 핵심 기능을 실제 UI 에서 5분간 사용
  3. `git diff main...HEAD` 전체 리뷰 — 의도하지 않은 변경 없는지
  4. 기존 기능 회귀 체크 (홈 화면 / 주요 페이지 load OK)
  
  결과물:
  - PASS 시: description 에 "회귀 없음, 핵심 기능 정상" 요약
  - FAIL 시: description 에 발견한 이슈 나열 → Fix 태스크 추가 필요
  
  주의: 이 태스크가 done 돼야 squash 단계로 진입한다.
role: qa | reviewer
type: review
priority: critical
target_files: []
```

**DB 영향**:
```sql
ALTER TABLE goals ADD COLUMN qa_regression_task_id TEXT
```

---

### S3. checkAndTriggerGoalSquash 가드 보강

QA 태스크 자체가 남은 태스크로 집계돼 무한 루프 가능 → QA 태스크는 "QA 성격" 으로 표시하고 `checkAndTriggerGoalSquash` 의 remaining 계산에서 **제외하지 않음** (normal task 로 취급).

로직 재정리:
```
checkAndTriggerGoalSquash(goalId):
  remaining = SELECT COUNT(*) FROM tasks
              WHERE goal_id=? AND status != 'done' AND parent_task_id IS NULL
  if remaining == 0:
    triggerGoalSquash(goalId)
    // QA 태스크 자동 생성되면 remaining 다시 1 이 됨
    // QA 태스크 done → 재차 호출되면 이번엔 qa_regression_task_id 가 set 이고
    // 모든 태스크 done 이므로 실제 squash 진행
```

---

## 구현 순서

| 순서 | 작업 | 파일 |
|------|------|------|
| 1 | DB 마이그레이션 — `qa_regression_task_id` 컬럼 | `server/db/schema.ts` |
| 2 | Adversarial 주입 로직 | `server/core/orchestration/engine.ts` (`decomposeGoal` 내) |
| 3 | QA 회귀 태스크 생성 헬퍼 + triggerGoalSquash 분기 | `server/core/orchestration/engine.ts` |

예상 변경: 2 파일, ~120줄.

---

## 위험 요소

| 위험 | 완화 |
|------|------|
| Adversarial 휴리스틱이 너무 자주 트리거 | 키워드 매칭 외에 `goal.description.length > 50` 조건 추가. 단순 goal 에는 주입 안 함 |
| QA 태스크 무한 생성 | `qa_regression_task_id` 컬럼으로 한 번만 생성. UPDATE 가 아토믹 트랜잭션 |
| Adversarial 태스크가 실패 시 전체 goal 블록 | adversarial 태스크 실패 = 기존 fail 경로 그대로 (retry → blocked) |
| 사용자가 adversarial 원치 않음 | goal 생성 시 `skip_adversarial` 플래그 추가 (UI 옵션) — 이번 구현 제외, 후속 |

---

## self_verify

- **confident**:
  - 휴리스틱 트리거 — 키워드 매칭은 단순하고 테스트 가능
  - QA 태스크 중복 방지 — DB 컬럼 기반이므로 서버 재시작해도 안전
  - 기존 Phase 2 데이터 흐름 (`checkAndTriggerGoalSquash` → `triggerGoalSquash`) 그대로 확장

- **uncertain**:
  - Adversarial 태스크의 order=0 삽입이 `depends_on` 체인과 잘 맞물리는지 — 기존 태스크의 depends_on 이 order 번호 기반이므로 order shift 시 depends_on 도 +1 해야 함

- **not_tested**:
  - QA 회귀 태스크가 실제로 "앱 실행 + UI 클릭" 을 수행할 수 있는지 — 에이전트 능력 의존
  - goal_slug 생성 로직 (adversarial 태스크의 target_files 에 필요) — 유일성 보장 필요
