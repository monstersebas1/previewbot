interface LogContext {
  prNumber?: number;
  action?: string;
  duration?: number;
  error?: string;
  [key: string]: unknown;
}

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function resolveMinLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LEVEL_ORDER) return env as LogLevel;
  if (process.env.NODE_ENV === "development") return "debug";
  return "info";
}

let cachedMinLevel: LogLevel = resolveMinLevel();

export function setLogLevel(level: LogLevel): void {
  cachedMinLevel = level;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[cachedMinLevel]) return;

  const entry = { timestamp: new Date().toISOString(), level, message, ...context };
  const line = JSON.stringify(entry);

  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const log = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
