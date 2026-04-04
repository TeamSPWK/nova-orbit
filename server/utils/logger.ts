const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

function log(level: LogLevel, module: string, message: string, data?: unknown): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${module}]`;

  if (data) {
    console[level === "error" ? "error" : "log"](`${prefix} ${message}`, data);
  } else {
    console[level === "error" ? "error" : "log"](`${prefix} ${message}`);
  }
}

export function createLogger(module: string) {
  return {
    debug: (msg: string, data?: unknown) => log("debug", module, msg, data),
    info: (msg: string, data?: unknown) => log("info", module, msg, data),
    warn: (msg: string, data?: unknown) => log("warn", module, msg, data),
    error: (msg: string, data?: unknown) => log("error", module, msg, data),
  };
}
