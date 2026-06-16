export type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const entry = {
    ...data,
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

export function info(message: string, data?: Record<string, unknown>): void {
  log('info', message, data);
}

export function warn(message: string, data?: Record<string, unknown>): void {
  log('warn', message, data);
}

export function error(message: string, data?: Record<string, unknown>): void {
  log('error', message, data);
}
