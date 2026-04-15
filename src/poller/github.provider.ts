import { Octokit } from 'octokit';
import type {
    GitProvider,
    ProviderPullRequest,
    ProviderCommit,
    ProviderFile,
} from '../shared/types.js';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('github-provider');

/** Minimum remaining API calls before we pause to avoid hitting the rate limit. */
const RATE_LIMIT_THRESHOLD = 100;

/**
 * GitHub implementation of the GitProvider interface.
 *
 * Wraps Octokit and maps GitHub API responses to normalized provider types.
 * Handles rate limiting by inspecting X-RateLimit-Remaining headers.
 */
export class GitHubProvider implements GitProvider {
    readonly providerName = 'github' as const;
    private octokit: Octokit;

    constructor(private token: string) {
        this.octokit = new Octokit({ auth: token });
    }

    async listPullRequests(
        repoFullName: string,
        state: 'open' | 'closed' | 'all'
    ): Promise<ProviderPullRequest[]> {
        const { owner, repo } = this.splitRepo(repoFullName);

        // GitHub API accepts "open", "closed", or "all" directly
        const response = await this.octokit.rest.pulls.list({
            owner,
            repo,
            state,
            per_page: 100,
            sort: 'updated',
            direction: 'desc',
        });

        this.checkRateLimit(response.headers);

        return response.data.map((pr) => {
            let mappedState: ProviderPullRequest['state'];
            if (pr.state === 'open') {
                mappedState = 'open';
            } else if (pr.merged_at) {
                // GitHub reports both merged and closed PRs as state="closed".
                // Check merged_at to distinguish.
                mappedState = 'merged';
            } else {
                mappedState = 'closed';
            }

            return {
                number: pr.number,
                title: pr.title,
                author: pr.user?.login ?? 'unknown',
                sourceBranch: pr.head.ref,
                targetBranch: pr.base.ref,
                isDraft: pr.draft ?? false,
                state: mappedState,
                url: pr.html_url,
            };
        });
    }

    async listPRCommits(
        repoFullName: string,
        prNumber: number
    ): Promise<ProviderCommit[]> {
        const { owner, repo } = this.splitRepo(repoFullName);

        const response = await this.octokit.rest.pulls.listCommits({
            owner,
            repo,
            pull_number: prNumber,
            per_page: 250,
        });

        this.checkRateLimit(response.headers);

        return response.data.map((c) => ({
            sha: c.sha,
            message: (c.commit.message ?? '').split('\n')[0],
            author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
            date: c.commit.author?.date ?? new Date().toISOString(),
        }));
    }

    async getPRDiff(
        repoFullName: string,
        prNumber: number
    ): Promise<string> {
        const { owner, repo } = this.splitRepo(repoFullName);

        const response = await this.octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: prNumber,
            mediaType: { format: 'diff' },
        });

        this.checkRateLimit(response.headers);

        // When format='diff', the data is a string (the unified diff),
        // but TypeScript types it as the normal PR object. Cast accordingly.
        return response.data as unknown as string;
    }

    async getPRFiles(
        repoFullName: string,
        prNumber: number
    ): Promise<ProviderFile[]> {
        const { owner, repo } = this.splitRepo(repoFullName);

        const response = await this.octokit.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: prNumber,
            per_page: 300,
        });

        this.checkRateLimit(response.headers);

        return response.data.map((f) => ({
            path: f.filename,
            additions: f.additions,
            deletions: f.deletions,
            status: this.mapFileStatus(f.status),
        }));
    }

    getCloneUrl(repoFullName: string): string {
        return `https://${this.token}@github.com/${repoFullName}.git`;
    }

    async getDefaultBranch(repoFullName: string): Promise<string> {
        const { owner, repo } = this.splitRepo(repoFullName);
        const { data } = await this.octokit.rest.repos.get({ owner, repo });
        return data.default_branch;
    }

    async postPrComment(
        repoFullName: string,
        prNumber: number,
        body: string
    ): Promise<{ url: string | null }> {
        const { owner, repo } = this.splitRepo(repoFullName);
        const { data } = await this.octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body,
        });
        log.info('Posted PR comment', { repo: repoFullName, pr: prNumber, commentId: data.id });
        return { url: data.html_url };
    }

    async getPRState(repoFullName: string, prNumber: number): Promise<import('../shared/types.js').PrState> {
        const { owner, repo } = this.splitRepo(repoFullName);
        const { data } = await this.octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
        if (data.merged) return 'merged';
        if (data.state === 'closed') return 'closed';
        return 'open';
    }

    // ── Private helpers ──────────────────────────────────────────

    private splitRepo(repoFullName: string): { owner: string; repo: string } {
        const [owner, repo] = repoFullName.split('/');
        if (!owner || !repo) {
            throw new Error(
                `Invalid GitHub repo format "${repoFullName}". Expected "owner/repo".`
            );
        }
        return { owner, repo };
    }

    private mapFileStatus(
        status: string
    ): ProviderFile['status'] {
        switch (status) {
            case 'added':
                return 'added';
            case 'removed':
                return 'deleted';
            case 'modified':
            case 'changed':
                return 'modified';
            case 'renamed':
                return 'renamed';
            default:
                log.warn('Unknown GitHub file status, defaulting to modified', {
                    status,
                });
                return 'modified';
        }
    }

    private checkRateLimit(
        headers: Record<string, string | number | undefined>
    ): void {
        const remaining = Number(headers['x-ratelimit-remaining']);
        const resetAt = Number(headers['x-ratelimit-reset']);

        if (!isNaN(remaining) && remaining < RATE_LIMIT_THRESHOLD) {
            const resetDate = new Date(resetAt * 1000);
            log.warn('GitHub API rate limit running low', {
                remaining,
                resetAt: resetDate.toISOString(),
            });
        }
    }
}
