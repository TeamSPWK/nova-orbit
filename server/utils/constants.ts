// Shared constants across server modules

// --- Agent roles ---
export const VALID_ROLES = [
  "coder", "reviewer", "marketer", "designer", "qa", "custom",
  "cto", "pm", "backend", "frontend", "ux", "devops",
] as const;

// --- Text limits ---
export const MAX_TITLE_LEN = 200;
export const MAX_DESC_LEN = 2000;
export const MAX_PROMPT_LEN = 50_000;
export const MAX_SUMMARY_LEN = 500;
export const MAX_TASKS_PER_GOAL = 10;

// --- Scheduler ---
export const POLL_INTERVAL_MS = parseInt(process.env.NOVA_POLL_INTERVAL_MS ?? "3000", 10);
export const BACKOFF_BASE_MS = parseInt(process.env.NOVA_BACKOFF_BASE_MS ?? "60000", 10);
export const BACKOFF_MAX_MS = parseInt(process.env.NOVA_BACKOFF_MAX_MS ?? "300000", 10);
export const MAX_CONSECUTIVE_RATE_LIMITS = parseInt(process.env.NOVA_MAX_RATE_LIMITS ?? "3", 10);
export const DEFAULT_MAX_CONCURRENCY = parseInt(process.env.NOVA_MAX_CONCURRENCY ?? "3", 10);

// --- Agent execution ---
export const TASK_TIMEOUT_MS = parseInt(process.env.NOVA_TASK_TIMEOUT_MS ?? "300000", 10); // 5 min default
export const RATE_LIMIT_WAIT_MS = parseInt(process.env.NOVA_RATE_LIMIT_WAIT_MS ?? "60000", 10);
export const SIGKILL_TIMEOUT_MS = 5000;

// --- Task retry ---
export const MAX_TASK_RETRIES = parseInt(process.env.NOVA_MAX_TASK_RETRIES ?? "2", 10);
export const MAX_REASSIGNS = parseInt(process.env.NOVA_MAX_REASSIGNS ?? "1", 10); // max agent switches per task
export const BLOCKED_RETRY_DELAY_MS = parseInt(process.env.NOVA_BLOCKED_RETRY_DELAY_MS ?? "10000", 10); // 10s cooldown
