import { describe, it, expect } from 'vitest';
import { computeBackoffSeconds, nextRetryTimestamp, RETRY_CAP_SECONDS } from './retry-policy.js';

describe('computeBackoffSeconds', () => {
    it('returns the base delay for the first retry', () => {
        expect(computeBackoffSeconds(1)).toBe(120);
    });

    it('doubles for each subsequent retry', () => {
        expect(computeBackoffSeconds(2)).toBe(240);
        expect(computeBackoffSeconds(3)).toBe(480);
        expect(computeBackoffSeconds(4)).toBe(960);
        expect(computeBackoffSeconds(5)).toBe(1920);
    });

    it('caps at RETRY_CAP_SECONDS once the curve exceeds it', () => {
        expect(computeBackoffSeconds(6)).toBe(RETRY_CAP_SECONDS); // 3840 -> capped 3600
        expect(computeBackoffSeconds(9)).toBe(RETRY_CAP_SECONDS);
        expect(computeBackoffSeconds(100)).toBe(RETRY_CAP_SECONDS);
    });
});

describe('nextRetryTimestamp', () => {
    it('adds the backoff delay to the given time as an ISO string', () => {
        const from = new Date('2026-06-18T00:00:00.000Z');
        expect(nextRetryTimestamp(1, from)).toBe('2026-06-18T00:02:00.000Z');
        expect(nextRetryTimestamp(2, from)).toBe('2026-06-18T00:04:00.000Z');
    });
});
