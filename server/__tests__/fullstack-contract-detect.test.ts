import { describe, it, expect } from "vitest";
import { isFullStackContractTask } from "../core/quality-gate/evaluator.js";

/**
 * Regression tests for P5 API Contract Mismatch gate.
 *
 * Motivating regressions (Pulsar audit 2026-04-09):
 * - SLA widget: backend `{items}`, frontend `{products}` → .length crash
 * - Content review table: backend `status: "draft"`, frontend map only had
 *   `pending/approved/rejected` → status.variant undefined crash
 * - Reliability: 5 ghost endpoints, frontend crashed on every poll
 *
 * All three were marked 100% complete because each individual task passed
 * its own code review. The new gate fires when a task description indicates
 * a fullstack / contract boundary so the evaluator is forced to diff both
 * sides of the schema.
 */
describe("isFullStackContractTask — fullstack boundary detection", () => {
  const positiveKorean = [
    "UI용 백엔드 API 확장 — 제품 관리 CRUD",
    "UI용 백엔드 API 확장 — 통계 & 파이프라인 상태",
    "대시보드 API 엔드포인트 추가",
    "API 엔드포인트 추가 및 프론트엔드 연동",
    "프론트엔드-백엔드 API 프록시 연동",
  ];

  for (const title of positiveKorean) {
    it(`matches Korean fullstack: "${title}"`, () => {
      expect(isFullStackContractTask(title, "")).toBe(true);
    });
  }

  const positiveEnglish = [
    "Add new API endpoint for analytics",
    "Implement /stats/daily-views handler",
    "Extend backend API with dashboard route",
    "Frontend integration with backend contract",
    "Add schema to API response",
  ];

  for (const title of positiveEnglish) {
    it(`matches English fullstack: "${title}"`, () => {
      expect(isFullStackContractTask(title, "")).toBe(true);
    });
  }

  const negative = [
    "Fix typo in README",
    "Refactor product card component",
    "Add sidebar icon",
    "Update dependencies",
    "Rename variable in utils",
  ];

  for (const title of negative) {
    it(`does NOT match: "${title}"`, () => {
      expect(isFullStackContractTask(title, "")).toBe(false);
    });
  }

  it("matches from description when title is generic", () => {
    expect(
      isFullStackContractTask(
        "Backend work",
        "Add a new endpoint /api/v1/sla/status and wire it to the frontend SLA widget",
      ),
    ).toBe(true);
  });
});
