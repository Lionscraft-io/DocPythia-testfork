/**
 * Simple logging utility
 * Provides structured logging with levels and consistent formatting
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private minLevel: number;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    const envLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.minLevel = LOG_LEVELS[options.level || envLevel] || LOG_LEVELS.info;
    this.prefix = options.prefix || '';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.minLevel;
  }

  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    const formattedArgs =
      args.length > 0
        ? ' ' +
          JSON.stringify(
            args.map((arg) => {
              // Properly serialize Error objects
              if (arg instanceof Error) {
                return {
                  name: arg.name,
                  message: arg.message,
                  stack: arg.stack,
                  ...(arg as any), // Include any additional properties
                };
              }
              return arg;
            })
          )
        : '';
    return `${timestamp} [${level.toUpperCase()}] ${prefix}${message}${formattedArgs}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, ...args));
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, ...args));
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, ...args));
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, ...args));
    }
  }

  /**
   * Create a child logger with a prefix
   */
  child(prefix: string): Logger {
    const fullPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new Logger({ prefix: fullPrefix });
  }
}

// Default logger instance
export const logger = new Logger();

// Factory function for creating named loggers
export function createLogger(name: string): Logger {
  return new Logger({ prefix: name });
}

/**
 * Safely extract error message from an unknown error
 * Useful for catch blocks where error type is unknown
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

/**
 * Check if an error has a specific message
 * Useful for catch blocks that need to check error.message
 */
export function hasErrorMessage(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message;
}

export default logger;
