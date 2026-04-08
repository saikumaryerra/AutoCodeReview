/**
 * Orchestrates the full review lifecycle: dequeue jobs, prepare repos,
 * invoke Claude CLI, parse output, and persist results.
 *
 * Runs a continuous processing loop that pulls one job at a time from
 * the in-memory queue.
 */

import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { ReviewJob, GitProvider, Provider, ProviderFile } from '../shared/types.js';
import type { ReviewQueue } from '../poller/queue.js';
import type { ConfigService } from '../config/config.service.js';
import type { ReviewsRepository } from '../database/reviews.repository.js';
import type { RepoManager } from './repo-manager.js';
import type { ClaudeCliExecutor } from './claude-cli.executor.js';
import { buildReviewPrompt } from './prompt.js';
import { parseClaudeOutput } from './parser.js';
import { createModuleLogger } from '../shared/logger.js';

const logger = createModuleLogger('reviewer-service');

// ── Provider factory interface ────────────────────────────────────
// Defined locally to avoid circular dependency with the poller module.
// The concrete ProviderFactory is injected at construction time.

export interface ProviderFactory {
    getProvider(providerName: Provider): Promise<GitProvider>;
}

// ── Current review tracking ───────────────────────────────────────

interface CurrentReview {
    repo: string;
    pr_number: number;
    commit_sha: string;
    started_at: string;
}

// ── Helper ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Service class ─────────────────────────────────────────────────

export class ReviewerService {
    private currentReview: CurrentReview | null = null;

    constructor(
        private readonly db: Database.Database,
        private readonly queue: ReviewQueue,
        private readonly providerFactory: ProviderFactory,
        private readonly configService: ConfigService,
        private readonly repoManager: RepoManager,
        private readonly claudeExecutor: ClaudeCliExecutor,
        private readonly reviewsRepo: ReviewsRepository,
    ) {}

    /**
     * Returns the review currently being processed, or null if idle.
     */
    getCurrentReview(): CurrentReview | null {
        return this.currentReview;
    }

    /**
     * Infinite processing loop. Dequeues one job at a time.
     * Sleeps for 5 seconds when the queue is empty.
     */
    async startProcessing(): Promise<void> {
        logger.info('Review processing loop started');

        while (true) {
            const job = this.queue.dequeue();
            if (job) {
                try {
                    await this.processReview(job);
                } catch (err) {
                    // This catch is a safety net. processReview has its own
                    // error handling, but if something truly unexpected happens
                    // (e.g., a bug in our code), we log and continue.
                    logger.error('Unhandled error in processReview', {
                        jobId: job.id,
                        repo: job.repoFullName,
                        pr: job.prNumber,
                        error: (err as Error).message,
                        stack: (err as Error).stack,
                    });
                }
            } else {
                await sleep(5000);
            }
        }
    }

    /**
     * Processes a single review job through the full lifecycle:
     * prepare -> diff -> prompt -> execute -> parse -> persist.
     */
    async processReview(job: ReviewJob): Promise<void> {
        const traceId = job.id;
        const logCtx = {
            traceId,
            repo: job.repoFullName,
            pr: job.prNumber,
            commit: job.commitSha.substring(0, 8),
        };

        logger.info('Processing review job', logCtx);

        // ── Step 1: Check for duplicate ───────────────────────────
        // If a review already exists for this (repo, pr, commit) and is not
        // pending, skip to avoid re-processing after reconciliation + poller
        // both enqueue the same commit.
        const existing = this.reviewsRepo.getByPR(job.repoFullName, job.prNumber)
            .find(r => r.commit_sha === job.commitSha);

        if (existing && existing.status !== 'pending') {
            logger.info('Review already exists with non-pending status, skipping duplicate', {
                ...logCtx,
                existingStatus: existing.status,
                existingId: existing.id,
            });
            return;
        }

        // ── Step 2: Insert pending review row ─────────────────────
        const reviewId = existing?.id ?? uuid();
        const now = new Date().toISOString();

        if (!existing) {
            this.reviewsRepo.insert({
                id: reviewId,
                repo_full_name: job.repoFullName,
                provider: job.provider,
                pr_number: job.prNumber,
                pr_title: job.prTitle,
                pr_author: job.prAuthor,
                commit_sha: job.commitSha,
                commit_message: job.commitMessage,
                branch_name: job.branchName,
                target_branch: job.targetBranch,
                summary: '',
                severity: 'info',
                findings: [],
                raw_output: '',
                files_reviewed: [],
                stats: { files_changed: 0, additions: 0, deletions: 0 },
                review_duration_ms: null,
                claude_model: null,
                status: 'pending',
                error_message: null,
                created_at: now,
            });
        }

        try {
            // ── Step 3: Get provider ──────────────────────────────
            const provider = await this.providerFactory.getProvider(job.provider);

            // ── Step 4: Prepare local checkout ────────────────────
            const cloneUrl = provider.getCloneUrl(job.repoFullName);
            const repoPath = await this.repoManager.prepare(
                job.repoFullName,
                job.branchName,
                job.commitSha,
                cloneUrl,
            );

            // ── Step 5: Generate diff ─────────────────────────────
            // Prefer local diff for consistency; fall back to provider API.
            let diff: string;
            try {
                diff = await this.repoManager.generateDiff(
                    job.repoFullName,
                    job.targetBranch,
                    job.commitSha,
                );
            } catch (diffErr) {
                logger.warn('Local diff generation failed, falling back to provider API', {
                    ...logCtx,
                    error: (diffErr as Error).message,
                });
                diff = await provider.getPRDiff(job.repoFullName, job.prNumber);
            }

            // ── Step 6: Get changed files ─────────────────────────
            let changedFiles: ProviderFile[];
            try {
                changedFiles = await provider.getPRFiles(job.repoFullName, job.prNumber);
            } catch (filesErr) {
                logger.warn('Failed to get PR files from provider', {
                    ...logCtx,
                    error: (filesErr as Error).message,
                });
                changedFiles = [];
            }

            // ── Step 7: Check skip conditions ─────────────────────
            const maxFilesChanged = this.configService.get<number>('review.maxFilesChanged');
            const maxDiffSize = this.configService.get<number>('review.maxDiffSize');

            if (changedFiles.length > maxFilesChanged) {
                logger.info('Skipping review: too many files changed', {
                    ...logCtx,
                    filesChanged: changedFiles.length,
                    maxFilesChanged,
                });
                this.reviewsRepo.updateStatus(reviewId, 'skipped',
                    `Skipped: ${changedFiles.length} files changed exceeds limit of ${maxFilesChanged}`);
                this.insertSeenCommit(job);
                return;
            }

            if (diff.length > maxDiffSize) {
                logger.info('Skipping review: diff too large', {
                    ...logCtx,
                    diffSize: diff.length,
                    maxDiffSize,
                });
                this.reviewsRepo.updateStatus(reviewId, 'skipped',
                    `Skipped: diff size ${diff.length} exceeds limit of ${maxDiffSize}`);
                this.insertSeenCommit(job);
                return;
            }

            // ── Step 8: Build prompt ──────────────────────────────
            const prompt = buildReviewPrompt({
                repoFullName: job.repoFullName,
                prNumber: job.prNumber,
                prTitle: job.prTitle,
                prAuthor: job.prAuthor,
                branchName: job.branchName,
                commitSha: job.commitSha,
                commitMessage: job.commitMessage,
                diff,
                changedFiles: changedFiles.map(f => f.path),
            });

            // ── Step 9: Update status to in_progress ──────────────
            this.reviewsRepo.updateStatus(reviewId, 'in_progress');
            this.currentReview = {
                repo: job.repoFullName,
                pr_number: job.prNumber,
                commit_sha: job.commitSha,
                started_at: new Date().toISOString(),
            };

            // ── Step 10: Execute Claude CLI ───────────────────────
            const cliResult = await this.claudeExecutor.executeReview(repoPath, prompt);

            // ── Step 11: Parse output ─────────────────────────────
            const parsed = parseClaudeOutput(cliResult.stdout);

            // Compute file stats
            const stats = {
                files_changed: changedFiles.length,
                additions: changedFiles.reduce((sum, f) => sum + f.additions, 0),
                deletions: changedFiles.reduce((sum, f) => sum + f.deletions, 0),
            };

            // ── Step 12: Persist completed review ─────────────────
            this.reviewsRepo.updateReview(reviewId, {
                summary: parsed.summary,
                severity: parsed.severity,
                findings: parsed.findings,
                raw_output: cliResult.stdout,
                files_reviewed: changedFiles.map(f => f.path),
                stats,
                review_duration_ms: cliResult.durationMs,
                claude_model: parsed.model ?? cliResult.model,
                status: cliResult.success ? 'completed' : 'failed',
            });

            if (!cliResult.success) {
                this.reviewsRepo.updateStatus(reviewId, 'failed',
                    `Claude CLI exited with code ${cliResult.exitCode}: ${cliResult.stderr.substring(0, 500)}`);
            }

            // ── Step 13: Mark commit as seen ──────────────────────
            this.insertSeenCommit(job);

            logger.info('Review completed', {
                ...logCtx,
                reviewId,
                severity: parsed.severity,
                findingsCount: parsed.findings.length,
                durationMs: cliResult.durationMs,
                model: parsed.model ?? cliResult.model,
            });

        } catch (err) {
            // ── Error path: mark as failed ────────────────────────
            const errorMessage = (err as Error).message ?? 'Unknown error';
            const errorStack = (err as Error).stack;

            logger.error('Review processing failed', {
                ...logCtx,
                reviewId,
                error: errorMessage,
                stack: errorStack,
            });

            this.reviewsRepo.updateStatus(reviewId, 'failed', errorMessage.substring(0, 2000));
            this.insertSeenCommit(job);
        } finally {
            // ── Step 14: Clear current review ─────────────────────
            this.currentReview = null;
        }
    }

    // ── Private helpers ───────────────────────────────────────────

    /**
     * Inserts a record into seen_commits so the poller does not re-enqueue
     * this (repo, pr, commit) combination. Uses INSERT OR IGNORE to handle
     * the case where reconciliation already inserted it.
     */
    private insertSeenCommit(job: ReviewJob): void {
        try {
            this.db.prepare(`
                INSERT OR IGNORE INTO seen_commits (repo_full_name, pr_number, commit_sha)
                VALUES (?, ?, ?)
            `).run(job.repoFullName, job.prNumber, job.commitSha);
        } catch (err) {
            logger.error('Failed to insert seen_commit', {
                repo: job.repoFullName,
                pr: job.prNumber,
                commit: job.commitSha.substring(0, 8),
                error: (err as Error).message,
            });
        }
    }
}
