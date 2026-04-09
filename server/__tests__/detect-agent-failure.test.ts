import { describe, it, expect } from "vitest";
import { detectAgentRunFailure, CLI_ERROR_LEAK_PATTERNS } from "../utils/errors.js";

/**
 * Regression tests for the silent-failure gate introduced after the Pulsar
 * incident where tasks like "로컬 개발 편의 스크립트 작성" were marked done
 * with result_summary = "API Error: Unable to connect to API (ECONNRESET)".
 *
 * These inputs are real DB rows from the Pulsar project's tasks table.
 */
describe("detectAgentRunFailure — Pulsar regression cases", () => {
  it("catches ECONNRESET leaked into assistant text (exit=0)", () => {
    const implResult = { exitCode: 0, stderr: "" };
    const implParsed = {
      text: "API Error: Unable to connect to API (ECONNRESET)",
      errors: [],
    };
    const failure = detectAgentRunFailure(implResult, implParsed);
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe("API_ERROR_LEAK");
  });

  it("catches 401 authentication_error in assistant text", () => {
    const implResult = { exitCode: 0, stderr: "" };
    const implParsed = {
      text: 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}',
      errors: [],
    };
    const failure = detectAgentRunFailure(implResult, implParsed);
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe("API_ERROR_LEAK");
  });

  it("catches non-zero exit code even with some text", () => {
    const implResult = { exitCode: 1, stderr: "connection refused" };
    const implParsed = { text: "partial output", errors: [] };
    const failure = detectAgentRunFailure(implResult, implParsed);
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe("CLI_EXIT_NONZERO");
  });

  it("catches stream parser errors (empty stdout)", () => {
    const implResult = { exitCode: 0, stderr: "" };
    const implParsed = {
      text: "",
      errors: ["Empty stdout from Claude Code CLI — no output received"],
    };
    const failure = detectAgentRunFailure(implResult, implParsed);
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe("STREAM_ERROR");
  });

  it("passes legitimate success output through", () => {
    const implResult = { exitCode: 0, stderr: "" };
    const implParsed = {
      text: "Task complete. Modified web/src/app/page.tsx with dashboard layout.",
      errors: [],
    };
    const failure = detectAgentRunFailure(implResult, implParsed);
    expect(failure).toBeNull();
  });

  it("does not false-positive on the word 'error' in normal context", () => {
    const implResult = { exitCode: 0, stderr: "" };
    const implParsed = {
      text: "Added error handling to the login flow. All edge cases covered.",
      errors: [],
    };
    const failure = detectAgentRunFailure(implResult, implParsed);
    expect(failure).toBeNull();
  });

  it("catches ECONNREFUSED", () => {
    const implResult = { exitCode: 0, stderr: "" };
    const implParsed = {
      text: "Error: connect ECONNREFUSED 127.0.0.1:8080",
      errors: [],
    };
    const failure = detectAgentRunFailure(implResult, implParsed);
    expect(failure).not.toBeNull();
  });

  it("catches 'Credit balance is too low'", () => {
    const implResult = { exitCode: 0, stderr: "" };
    const implParsed = {
      text: "Your credit balance is too low to access the Anthropic API",
      errors: [],
    };
    const failure = detectAgentRunFailure(implResult, implParsed);
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe("API_ERROR_LEAK");
  });

  it("exitCode === null (process killed by signal) is treated as pending, not hard failure", () => {
    // Note: signal-killed processes already surface via other paths (timeout,
    // rate-limit). The gate should not double-fail on exitCode === null.
    const implResult = { exitCode: null, stderr: "[nova] process terminated by signal SIGTERM" };
    const implParsed = { text: "some partial output", errors: [] };
    const failure = detectAgentRunFailure(implResult, implParsed);
    expect(failure).toBeNull();
  });
});

describe("CLI_ERROR_LEAK_PATTERNS — export for extensibility", () => {
  it("exports at least 8 patterns", () => {
    expect(CLI_ERROR_LEAK_PATTERNS.length).toBeGreaterThanOrEqual(8);
  });

  it("all entries are RegExp", () => {
    for (const p of CLI_ERROR_LEAK_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});
