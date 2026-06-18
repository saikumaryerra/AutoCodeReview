/**
 * Pure backoff math for automatic review retries.
 *
 * Schedule for retries 1..9: 2, 4, 8, 16, 32, 60, 60, 60, 60 minutes
 * (exponential, capped at RETRY_CAP_SECONDS).
 */

export const RETRY_BASE_SECONDS = 120;
export const RETRY_FACTOR = 2;
export const RETRY_CAP_SECONDS = 3600;

/**
 * Delay in seconds before retry number `retryNumber` (1-based).
 */
export function computeBackoffSeconds(retryNumber: number): number {
    const raw = RETRY_BASE_SECONDS * Math.pow(RETRY_FACTOR, retryNumber - 1);
    return Math.min(RETRY_CAP_SECONDS, raw);
}

/**
 * ISO-8601 timestamp at which retry number `retryNumber` becomes due,
 * measured from `from`.
 */
export function nextRetryTimestamp(retryNumber: number, from: Date): string {
    const ms = from.getTime() + computeBackoffSeconds(retryNumber) * 1000;
    return new Date(ms).toISOString();
}
