import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { ReviewJob, Provider, Repository } from '../shared/types.js';
import { ConflictError } from '../shared/errors.js';
import { createModuleLogger } from '../shared/logger.js';
import type { ReviewQueue } from './queue.js';
import type { ProviderFactory } from './provider.factory.js';
import type { ConfigService } from '../config/config.service.js';

const log = createModuleLogger('poller-service');

/**
 * Row shape returned when querying active repositories from the database.
 */
interface RepoRow {
    id: string;
    full_name: string;
    provider: string;
    org_url: string | null;
    default_branch: string;
    is_active: number;
    last_polled_at: string | null;
}

/**
 * Row shape for seen_commits existence check.
 */
interface SeenCommitRow {
    commit_sha: string;
}

/**
 * Summary of a single poll cycle, returned by triggerManualPoll.
 */
export interface PollResult {
    reposPolled: number;
    reposFailed: number;
    newJobsEnqueued: number;
    providerBreakdown: Record<string, number>;
    durationMs: number;
}

/**
 * The PollerService is the heartbeat of AutoCodeReview.
 *
 * It periodically checks all active repositories for new PR commits,
 * compares them against the seen_commits table, and enqueues new review
 * jobs for any unseen commits.
 *
 * Scheduling uses setInterval rather than cron for flexibility with
 * arbitrary second-level intervals. The interval is dynamically updated
 * when polling.intervalSeconds changes via the ConfigService.
 */
export class PollerService {
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private isPolling = false;
    private lastPollAt: Date | null = null;
    private nextPollAt: Date | null = null;

    // Prepared statements (lazily created)
    private stmtGetActiveRepos: Database.Statement | null = null;
    private stmtCheckSeenCommit: Database.Statement | null = null;
    private stmtUpdateLastPolled: Database.Statement | null = null;

    constructor(
        private db: Database.Database,
        private queue: ReviewQueue,
        private providerFactory: ProviderFactory,
        private configService: ConfigService
    ) {}

    /**
     * Start the polling loop. Schedules the first poll immediately,
     * then repeats at the configured interval.
     *
     * Listens for runtime config changes to polling.intervalSeconds
     * and reschedules automatically.
     */
    start(): void {
        const intervalSeconds = this.configService.get<number>(
            'polling.intervalSeconds'
        );

        this.schedulePolling(intervalSeconds);

        // React to runtime config changes
        this.configService.onChange(
            'polling.intervalSeconds',
            (value: unknown) => {
                const newInterval = value as number;
                log.info('Polling interval changed, rescheduling', {
                    newIntervalSeconds: newInterval,
                });
                this.schedulePolling(newInterval);
            }
        );

        log.info('Poller service started', { intervalSeconds });
    }

    /**
     * Stop the polling loop. Safe to call even if not started.
     */
    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
            this.nextPollAt = null;
            log.info('Poller service stopped');
        }
    }

    /**
     * Trigger an immediate poll cycle. Throws ConflictError if a poll
     * is already in progress.
     */
    async triggerManualPoll(): Promise<PollResult> {
        if (this.isPolling) {
            throw new ConflictError(
                'A poll cycle is already in progress. Please wait for it to finish.'
            );
        }
        return this.poll();
    }

    /**
     * Returns the timestamp of the last completed poll, or null if
     * no poll has run yet.
     */
    getLastPollAt(): Date | null {
        return this.lastPollAt;
    }

    /**
     * Returns the timestamp of the next scheduled poll, or null if
     * the poller is stopped.
     */
    getNextPollAt(): Date | null {
        return this.nextPollAt;
    }

    /**
     * Whether a poll cycle is currently executing.
     */
    getIsPolling(): boolean {
        return this.isPolling;
    }

    // ── Core polling logic ───────────────────────────────────────

    private async poll(): Promise<PollResult> {
        const startTime = Date.now();
        this.isPolling = true;

        let reposPolled = 0;
        let reposFailed = 0;
        let newJobsEnqueued = 0;
        const providerBreakdown: Record<string, number> = {};

        try {
            const activeRepos = this.getActiveRepos();

            if (activeRepos.length === 0) {
                log.info('No active repositories to poll');
                return {
                    reposPolled: 0,
                    reposFailed: 0,
                    newJobsEnqueued: 0,
                    providerBreakdown: {},
                    durationMs: Date.now() - startTime,
                };
            }

            const skipDrafts = this.configService.get<boolean>(
                'review.skipDrafts'
            );
            const prStateFilter = this.configService.get<
                'open' | 'closed' | 'all'
            >('review.prStateFilter');

            for (const repo of activeRepos) {
                try {
                    const jobsFound = await this.pollSingleRepo(
                        repo,
                        prStateFilter,
                        skipDrafts
                    );

                    reposPolled++;
                    newJobsEnqueued += jobsFound;

                    const providerName = repo.provider;
                    providerBreakdown[providerName] =
                        (providerBreakdown[providerName] ?? 0) + 1;

                    // Update last_polled_at for this repo
                    this.updateLastPolledAt(repo.full_name);
                } catch (err) {
                    reposFailed++;
                    log.error('Failed to poll repository', {
                        repo: repo.full_name,
                        provider: repo.provider,
                        error:
                            err instanceof Error
                                ? err.message
                                : String(err),
                    });
                    // Continue to next repo -- don't let one failure stop all polling
                }
            }

            const durationMs = Date.now() - startTime;

            log.info('Poll cycle complete', {
                reposPolled,
                reposFailed,
                newJobsEnqueued,
                providerBreakdown,
                durationMs,
            });

            return {
                reposPolled,
                reposFailed,
                newJobsEnqueued,
                providerBreakdown,
                durationMs,
            };
        } finally {
            this.isPolling = false;
            this.lastPollAt = new Date();
        }
    }

    /**
     * Polls a single repository for new PR commits.
     * Returns the number of new review jobs enqueued.
     */
    private async pollSingleRepo(
        repo: RepoRow,
        prStateFilter: 'open' | 'closed' | 'all',
        skipDrafts: boolean
    ): Promise<number> {
        const provider = await this.providerFactory.getProvider(
            repo.provider as Provider
        );

        const pullRequests = await provider.listPullRequests(
            repo.full_name,
            prStateFilter
        );

        let newJobs = 0;

        for (const pr of pullRequests) {
            // Skip draft PRs if configured
            if (skipDrafts && pr.isDraft) {
                log.debug('Skipping draft PR', {
                    repo: repo.full_name,
                    pr: pr.number,
                    title: pr.title,
                });
                continue;
            }

            try {
                const commits = await provider.listPRCommits(
                    repo.full_name,
                    pr.number
                );

                if (commits.length === 0) {
                    log.debug('PR has no commits', {
                        repo: repo.full_name,
                        pr: pr.number,
                    });
                    continue;
                }

                // Take the latest commit (last in the array = head of the PR branch)
                const latestCommit = commits[commits.length - 1];

                // Check if we've already seen this commit
                if (
                    this.isCommitSeen(
                        repo.full_name,
                        pr.number,
                        latestCommit.sha
                    )
                ) {
                    log.debug('Commit already seen', {
                        repo: repo.full_name,
                        pr: pr.number,
                        commit: latestCommit.sha.substring(0, 8),
                    });
                    continue;
                }

                // Check if a review already exists for this commit (pending or in_progress)
                if (
                    this.hasExistingReview(
                        repo.full_name,
                        pr.number,
                        latestCommit.sha
                    )
                ) {
                    log.debug('Review already exists for commit', {
                        repo: repo.full_name,
                        pr: pr.number,
                        commit: latestCommit.sha.substring(0, 8),
                    });
                    continue;
                }

                // Enqueue the review job
                const job: ReviewJob = {
                    id: uuid(),
                    repoFullName: repo.full_name,
                    provider: repo.provider as Provider,
                    prNumber: pr.number,
                    prTitle: pr.title,
                    prAuthor: pr.author,
                    commitSha: latestCommit.sha,
                    commitMessage: latestCommit.message,
                    branchName: pr.sourceBranch,
                    enqueuedAt: new Date(),
                };

                this.queue.enqueue(job);
                newJobs++;

                log.info('New review job enqueued', {
                    repo: repo.full_name,
                    pr: pr.number,
                    commit: latestCommit.sha.substring(0, 8),
                    author: pr.author,
                });
            } catch (err) {
                log.error('Failed to process PR', {
                    repo: repo.full_name,
                    pr: pr.number,
                    error:
                        err instanceof Error ? err.message : String(err),
                });
                // Continue to next PR
            }
        }

        return newJobs;
    }

    // ── Database access ──────────────────────────────────────────

    private getActiveRepos(): RepoRow[] {
        if (!this.stmtGetActiveRepos) {
            this.stmtGetActiveRepos = this.db.prepare(`
                SELECT id, full_name, provider, org_url, default_branch,
                       is_active, last_polled_at
                FROM repositories
                WHERE is_active = 1
            `);
        }
        return this.stmtGetActiveRepos.all() as RepoRow[];
    }

    private isCommitSeen(
        repoFullName: string,
        prNumber: number,
        commitSha: string
    ): boolean {
        if (!this.stmtCheckSeenCommit) {
            this.stmtCheckSeenCommit = this.db.prepare(`
                SELECT commit_sha FROM seen_commits
                WHERE repo_full_name = ? AND pr_number = ? AND commit_sha = ?
            `);
        }
        const row = this.stmtCheckSeenCommit.get(
            repoFullName,
            prNumber,
            commitSha
        ) as SeenCommitRow | undefined;
        return row !== undefined;
    }

    private hasExistingReview(
        repoFullName: string,
        prNumber: number,
        commitSha: string
    ): boolean {
        const stmt = this.db.prepare(`
            SELECT id FROM reviews
            WHERE repo_full_name = ? AND pr_number = ? AND commit_sha = ?
            AND status IN ('pending', 'in_progress')
        `);
        const row = stmt.get(repoFullName, prNumber, commitSha);
        return row !== undefined;
    }

    private updateLastPolledAt(repoFullName: string): void {
        if (!this.stmtUpdateLastPolled) {
            this.stmtUpdateLastPolled = this.db.prepare(`
                UPDATE repositories
                SET last_polled_at = datetime('now')
                WHERE full_name = ?
            `);
        }
        this.stmtUpdateLastPolled.run(repoFullName);
    }

    // ── Scheduling ───────────────────────────────────────────────

    private schedulePolling(intervalSeconds: number): void {
        // Clear existing interval if any
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
        }

        const intervalMs = intervalSeconds * 1000;

        // Schedule the repeating poll
        this.intervalHandle = setInterval(() => {
            this.nextPollAt = new Date(Date.now() + intervalMs);
            this.poll().catch((err) => {
                log.error('Unhandled error in poll cycle', {
                    error:
                        err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined,
                });
            });
        }, intervalMs);

        // Set next poll time
        this.nextPollAt = new Date(Date.now() + intervalMs);

        // Run an initial poll immediately
        this.poll().catch((err) => {
            log.error('Unhandled error in initial poll', {
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
            });
        });
    }
}
