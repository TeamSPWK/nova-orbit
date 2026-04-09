import { describe, it, expect } from "vitest";
import { isExecutionVerificationTask, autoDetectScope } from "../core/quality-gate/evaluator.js";

/**
 * Regression tests for the execution-verification detection.
 * Pulsar tasks that were the original motivation:
 * - "프론트엔드 12개 페이지 렌더링 검증" — was marked done without rendering
 * - "전체 로컬 실행 통합 검증 (QA)" — was marked done without running
 * - "Docker Compose 기동 검증 — API 서비스" — actually worked, must still match
 */
describe("isExecutionVerificationTask — Pulsar task titles", () => {
  const positive = [
    "프론트엔드 12개 페이지 렌더링 검증",
    "전체 로컬 실행 통합 검증 (QA)",
    "Docker Compose 기동 검증 — API 서비스",
    "백엔드 API 로컬 (non-Docker) 기동 검증",
    "로컬 실행 스모크 테스트",
    "Smoke test the dev server",
    "End-to-end verify the login flow",
    "Integration test for payment",
    "verify it runs locally",
  ];

  for (const title of positive) {
    it(`matches: "${title}"`, () => {
      expect(isExecutionVerificationTask(title, "")).toBe(true);
    });
  }

  const negative = [
    "제품 관리 CRUD UI 구현",
    "대시보드 홈 페이지 구현",
    "통계 API 추가",
    "Add user profile component",
    "Refactor auth middleware",
  ];

  for (const title of negative) {
    it(`does NOT match: "${title}"`, () => {
      expect(isExecutionVerificationTask(title, "")).toBe(false);
    });
  }

  it("matches from description when title is generic", () => {
    expect(isExecutionVerificationTask("Final QA", "Run smoke tests and verify the build works")).toBe(true);
  });
});

describe("autoDetectScope — execution tasks escalate to full", () => {
  it("execution verification task → full scope regardless of file count", () => {
    expect(autoDetectScope({ title: "프론트엔드 렌더링 검증", description: "" }, 1)).toBe("full");
    expect(autoDetectScope({ title: "로컬 실행 통합 검증", description: "" }, 0)).toBe("full");
  });

  it("normal small task → lite scope", () => {
    expect(autoDetectScope({ title: "Fix typo in README", description: "" }, 1)).toBe("lite");
  });

  it("auth task → full scope (existing rule)", () => {
    expect(autoDetectScope({ title: "Implement JWT auth middleware", description: "" }, 2)).toBe("full");
  });
});
