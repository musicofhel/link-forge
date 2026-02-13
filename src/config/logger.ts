import pino from "pino";

export function createLogger(level = "info", name?: string): pino.Logger {
  return pino({
    level,
    name,
    transport:
      process.env["NODE_ENV"] !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });
}
