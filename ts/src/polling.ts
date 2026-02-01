/**
 * Polling utilities for waiting on async state transitions.
 */

export class PollingTimeoutError extends Error {
  constructor(message: string, public lastResult?: unknown) {
    super(message);
    this.name = "PollingTimeoutError";
  }
}

export type PollOptions<T> = {
  intervalMs: number;
  timeoutMs: number;
  onPoll?: (result: T, elapsedMs: number) => void;
};

/**
 * Poll until a predicate returns true or timeout is reached.
 */
export async function pollUntil<T>(
  fetch: () => Promise<T>,
  predicate: (result: T) => boolean,
  opts: PollOptions<T>
): Promise<T> {
  const startTime = Date.now();
  let lastResult: T | undefined;

  while (Date.now() - startTime < opts.timeoutMs) {
    lastResult = await fetch();
    const elapsed = Date.now() - startTime;

    if (opts.onPoll) {
      opts.onPoll(lastResult, elapsed);
    }

    if (predicate(lastResult)) {
      return lastResult;
    }

    await sleep(opts.intervalMs);
  }

  throw new PollingTimeoutError(
    `Polling timed out after ${opts.timeoutMs}ms`,
    lastResult
  );
}

/**
 * Sleep for the specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Default polling intervals (in milliseconds)
export const POLL_INTERVALS = {
  TASK_PROPOSAL: 3000,      // Wait for task proposal after chat
  VERIFICATION_QUESTION: 15000,  // Wait for verification question
  FINAL_STATUS: 30000,      // Wait for rewarded/refused
} as const;

// Default timeouts (in milliseconds)
export const POLL_TIMEOUTS = {
  TASK_PROPOSAL: 60000,     // 1 minute
  VERIFICATION_QUESTION: 300000, // 5 minutes
  FINAL_STATUS: 1800000,    // 30 minutes
} as const;
