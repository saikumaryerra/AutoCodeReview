/**
 * Re-exports provider types from shared/types for backwards compatibility
 * and clean imports within the poller module.
 */
export type {
    GitProvider,
    ProviderPullRequest,
    ProviderCommit,
    ProviderFile,
} from '../shared/types.js';
