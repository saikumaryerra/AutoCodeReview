import { describe, it, expect } from 'vitest';
import { CONFIG_REGISTRY } from './config.schema.js';

const OVERRIDABLE = [
    'review.skipDrafts',
    'review.maxFilesChanged',
    'review.maxDiffSize',
    'review.prStateFilter',
    'review.autoPostComment',
    'review.autoPostSkipClean',
    'review.retryEnabled',
    'review.maxRetryAttempts',
];

describe('CONFIG_REGISTRY perRepoOverridable', () => {
    it('marks exactly the 8 review keys as overridable', () => {
        const flagged = CONFIG_REGISTRY.filter(m => m.perRepoOverridable).map(m => m.key).sort();
        expect(flagged).toEqual([...OVERRIDABLE].sort());
    });

    it('does not mark claude/polling/retention keys as overridable', () => {
        for (const key of ['claude.model', 'claude.reviewTimeoutSeconds', 'polling.intervalSeconds', 'review.retentionDays']) {
            const meta = CONFIG_REGISTRY.find(m => m.key === key);
            expect(meta?.perRepoOverridable ?? false).toBe(false);
        }
    });
});
