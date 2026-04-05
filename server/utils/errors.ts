// Nova Orbit — Structured Error Types (Sprint 5)

export type NovaAgentErrorCode =
  | "RATE_LIMIT"
  | "SESSION_EXPIRED"
  | "SPAWN_FAILED"
  | "TIMEOUT";

export interface NovaAgentErrorData {
  code: NovaAgentErrorCode;
  message: string;
  detail?: string;
  recovery?: string;
}

export class NovaAgentError extends Error {
  readonly code: NovaAgentErrorCode;
  readonly detail?: string;
  readonly recovery?: string;

  constructor(data: NovaAgentErrorData) {
    super(data.message);
    this.name = "NovaAgentError";
    this.code = data.code;
    this.detail = data.detail;
    this.recovery = data.recovery;
  }

  toJSON(): NovaAgentErrorData {
    return {
      code: this.code,
      message: this.message,
      detail: this.detail,
      recovery: this.recovery,
    };
  }
}

// Factory helpers — map raw error signals to structured errors

export function makeRateLimitError(detail?: string): NovaAgentError {
  return new NovaAgentError({
    code: "RATE_LIMIT",
    message: "API rate limit reached. Execution paused.",
    detail,
    recovery: "Wait for the backoff period to expire or switch to a different API key.",
  });
}

export function makeSessionExpiredError(sessionId: string): NovaAgentError {
  return new NovaAgentError({
    code: "SESSION_EXPIRED",
    message: `Claude session '${sessionId}' is no longer available.`,
    detail: `Session ID: ${sessionId}`,
    recovery: "A fresh session will be started automatically on the next attempt.",
  });
}

export function makeSpawnFailedError(detail?: string): NovaAgentError {
  return new NovaAgentError({
    code: "SPAWN_FAILED",
    message: "Failed to spawn Claude Code CLI process.",
    detail,
    recovery: "Ensure the 'claude' CLI is installed and ANTHROPIC_API_KEY is set.",
  });
}

export function makeTimeoutError(timeoutMs: number): NovaAgentError {
  return new NovaAgentError({
    code: "TIMEOUT",
    message: `Task execution timed out after ${timeoutMs / 1000}s.`,
    detail: `Timeout: ${timeoutMs}ms`,
    recovery: "Break the task into smaller sub-tasks or increase the timeout limit.",
  });
}
