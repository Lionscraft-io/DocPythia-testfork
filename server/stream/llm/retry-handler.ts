/**
 * Retry Handler
 * Handles retry logic with exponential backoff for LLM requests

 * Date: 2025-12-23
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  transientDelayMultiplier: number;
}

export interface RetryableError extends Error {
  transient?: boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 2000,
  transientDelayMultiplier: 2,
};

/**
 * Handles retry logic with configurable backoff strategy
 */
export class RetryHandler {
  private config: RetryConfig;
  private delayFn: (ms: number) => Promise<void>;

  constructor(config: Partial<RetryConfig> = {}, delayFn?: (ms: number) => Promise<void>) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.delayFn = delayFn || RetryHandler.defaultDelay;
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    operation: () => Promise<T>,
    onRetry?: (attempt: number, error: Error, delayMs: number) => void
  ): Promise<T> {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const err = error as RetryableError;
        const isTransient = err.transient === true;
        const isLastAttempt = attempt >= this.config.maxRetries;

        // For non-transient errors or last attempt, throw immediately
        if (!isTransient || isLastAttempt) {
          throw error;
        }

        // Calculate delay with exponential backoff
        const delay = this.calculateDelay(attempt, isTransient);

        // Notify caller about retry
        if (onRetry) {
          onRetry(attempt, err, delay);
        }

        await this.delayFn(delay);
      }
    }

    throw new Error('Retry handler exhausted all attempts');
  }

  /**
   * Calculate delay for a given attempt
   */
  calculateDelay(attempt: number, isTransient: boolean): number {
    const multiplier = isTransient ? this.config.transientDelayMultiplier : 1;
    return this.config.baseDelayMs * Math.pow(2, attempt - 1) * multiplier;
  }

  /**
   * Default delay implementation using setTimeout
   */
  static defaultDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a transient error (will be retried)
   */
  static transientError(message: string): RetryableError {
    const error = new Error(message) as RetryableError;
    error.transient = true;
    return error;
  }

  /**
   * Create a permanent error (will not be retried)
   */
  static permanentError(message: string): RetryableError {
    const error = new Error(message) as RetryableError;
    error.transient = false;
    return error;
  }
}
