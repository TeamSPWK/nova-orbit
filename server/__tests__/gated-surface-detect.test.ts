import { describe, it, expect } from "vitest";
import { isGatedSurfaceTask } from "../core/quality-gate/evaluator.js";

/**
 * Regression tests for Entry Point Completeness gate detection.
 *
 * Real motivating task: "멀티테넌트 접근 제어 + API 인증 — JWT/API Key 인증"
 * — the Pulsar goal that shipped a complete auth stack with empty users.yaml
 * and no /login page, leaving the dashboard at permanent 401.
 */
describe("isGatedSurfaceTask — gated feature detection", () => {
  const positiveKorean = [
    "멀티테넌트 접근 제어 + API 인증",
    "JWT 로그인 구현",
    "회원가입 플로우",
    "권한 검증 미들웨어",
    "테넌트 격리",
    "DB 스키마 마이그레이션",
    "온보딩 플로우 구현",
    "시드 데이터 작성",
  ];

  for (const title of positiveKorean) {
    it(`matches Korean: "${title}"`, () => {
      expect(isGatedSurfaceTask(title, "")).toBe(true);
    });
  }

  const positiveEnglish = [
    "Implement JWT authentication",
    "Add login page",
    "RBAC middleware",
    "Add tenant isolation",
    "DB migration: users table",
    "Onboarding wizard",
    "Seed default admin user",
    "API key rotation",
    "Token refresh endpoint",
    "Sign-in form",
    "Permission check on /admin",
  ];

  for (const title of positiveEnglish) {
    it(`matches English: "${title}"`, () => {
      expect(isGatedSurfaceTask(title, "")).toBe(true);
    });
  }

  const negative = [
    "대시보드 홈 페이지 구현",
    "제품 카드 컴포넌트 추가",
    "Fix typo in README",
    "Refactor chart colors",
    "Update dependencies",
    "Add sidebar icon",
  ];

  for (const title of negative) {
    it(`does NOT match: "${title}"`, () => {
      expect(isGatedSurfaceTask(title, "")).toBe(false);
    });
  }

  it("matches from description when title is generic", () => {
    expect(
      isGatedSurfaceTask(
        "Backend polish",
        "Add JWT verification to protected routes and a login page",
      ),
    ).toBe(true);
  });
});
