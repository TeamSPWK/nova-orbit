import { describe, it, expect } from "vitest";

/**
 * Unit tests for orchestration engine logic.
 * Tests pure functions and state transition rules without DB/session dependencies.
 */

// Rate limit detection — mirrors engine.ts and scheduler.ts logic
function isRateLimit(message: string): boolean {
  const msg = message.toLowerCase();
  return msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests");
}

describe("Rate limit detection", () => {
  it("detects 'rate limit' message", () => {
    expect(isRateLimit("Rate limit exceeded")).toBe(true);
  });

  it("detects '429' status code", () => {
    expect(isRateLimit("HTTP 429 Too Many Requests")).toBe(true);
  });

  it("detects 'too many requests'", () => {
    expect(isRateLimit("too many requests")).toBe(true);
  });

  it("does NOT match 'out of memory'", () => {
    expect(isRateLimit("out of memory")).toBe(false);
  });

  it("does NOT match 'out of bounds'", () => {
    expect(isRateLimit("Path out of bounds")).toBe(false);
  });

  it("does NOT match generic errors", () => {
    expect(isRateLimit("ENOENT: file not found")).toBe(false);
  });
});

// Verdict correction — mirrors evaluator.ts logic
function correctVerdict(aiVerdict: string, avgScore: number): string {
  let verdict = aiVerdict;
  if (avgScore >= 6 && verdict === "fail") verdict = "pass";
  else if (avgScore >= 4 && verdict === "fail") verdict = "conditional";
  return verdict;
}

describe("Verdict score correction", () => {
  it("corrects fail→pass when avg >= 6", () => {
    expect(correctVerdict("fail", 7.2)).toBe("pass");
  });

  it("corrects fail→conditional when 4 <= avg < 6", () => {
    expect(correctVerdict("fail", 5.0)).toBe("conditional");
  });

  it("keeps fail when avg < 4", () => {
    expect(correctVerdict("fail", 3.5)).toBe("fail");
  });

  it("does not modify pass verdict", () => {
    expect(correctVerdict("pass", 3.0)).toBe("pass");
  });

  it("does not modify conditional verdict", () => {
    expect(correctVerdict("conditional", 7.0)).toBe("conditional");
  });

  it("boundary: exactly 6.0 → pass", () => {
    expect(correctVerdict("fail", 6.0)).toBe("pass");
  });

  it("boundary: exactly 4.0 → conditional", () => {
    expect(correctVerdict("fail", 4.0)).toBe("conditional");
  });
});

// Task status transition — mirrors engine.ts logic
function resolveTaskStatus(verdict: string, autoFix: boolean): string {
  if (verdict === "pass" || verdict === "conditional") return "done";
  if (verdict === "fail" && autoFix) return "pending_fix"; // auto-fix will handle
  return "blocked";
}

describe("Task status resolution from verdict", () => {
  it("pass → done", () => {
    expect(resolveTaskStatus("pass", false)).toBe("done");
  });

  it("conditional → done", () => {
    expect(resolveTaskStatus("conditional", false)).toBe("done");
  });

  it("fail without autoFix → blocked", () => {
    expect(resolveTaskStatus("fail", false)).toBe("blocked");
  });

  it("fail with autoFix → pending_fix", () => {
    expect(resolveTaskStatus("fail", true)).toBe("pending_fix");
  });
});

// Backoff calculation — mirrors scheduler.ts logic
function calculateBackoff(attempt: number, baseMs = 60000, maxMs = 300000): number {
  return Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
}

describe("Exponential backoff", () => {
  it("attempt 1 → 60s", () => {
    expect(calculateBackoff(1)).toBe(60000);
  });

  it("attempt 2 → 120s", () => {
    expect(calculateBackoff(2)).toBe(120000);
  });

  it("attempt 3 → 240s", () => {
    expect(calculateBackoff(3)).toBe(240000);
  });

  it("attempt 4 → capped at 300s", () => {
    expect(calculateBackoff(4)).toBe(300000);
  });

  it("attempt 10 → still capped at 300s", () => {
    expect(calculateBackoff(10)).toBe(300000);
  });
});
