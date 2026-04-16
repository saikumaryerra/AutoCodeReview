import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { validateQuery, validate } from '../middleware/validate.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { createModuleLogger } from '../../shared/logger.js';
import type { ReviewsRepository } from '../../database/reviews.repository.js';
import type { ReviewQueue } from '../../poller/queue.js';
import type { ReviewJob, Provider } from '../../shared/types.js';
import type Database from 'better-sqlite3';

const logger = createModuleLogger('reviews-routes');

// ── Zod schemas for query/body validation ─────────────────────────

const ListReviewsQuerySchema = z.object({
    repo: z.string().optional(),
    provider: z.enum(['github', 'azure_devops']).optional(),
    pr: z.coerce.number().int().positive().optional(),
    commit: z.string().min(7).optional(),
    severity: z.enum(['critical', 'warning', 'info', 'clean']).optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped']).optional(),
    pr_state: z.enum(['open', 'closed', 'merged']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['created_at', 'severity', 'pr_number']).default('created_at'),
    order: z.enum(['asc', 'desc']).default('desc'),
});

const TriggerReviewBodySchema = z.object({
    repo_full_name: z.string().min(1).regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format'),
    pr_number: z.number().int().positive(),
    commit_sha: z.string().min(7).max(40),
    force: z.boolean().optional().default(false),
});

// ── Async handler wrapper ─────────────────────────────────────────

type AsyncHandler = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler): import('express').RequestHandler {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}

// ── Dependencies interface ────────────────────────────────────────

export interface ReviewsRouterDeps {
    reviewsRepo: ReviewsRepository;
    queue: ReviewQueue;
    providerFactory: { getProvider(name: Provider): import('../../shared/types.js').GitProvider };
    configService: { get<T>(key: string): T };
    db: Database.Database;
}

// ── Router factory ────────────────────────────────────────────────

export function createReviewsRouter(deps: ReviewsRouterDeps): Router {
    const router = Router();
    const { reviewsRepo, queue, db } = deps;

    // GET / — List reviews with filtering and pagination
    router.get(
        '/',
        validateQuery(ListReviewsQuerySchema),
        asyncHandler(async (req, res) => {
            const filters = req.query as unknown as z.infer<typeof ListReviewsQuerySchema>;

            logger.debug('Listing reviews', { filters });

            const result = reviewsRepo.list(filters);

            res.json(result);
        })
    );

    // NOTE: Specific path routes (/pr/..., /commit/..., /trigger) are registered
    // BEFORE the parameterized /:id route to avoid /:id matching "pr", "commit", etc.

    // GET /pr/:repoFullName/:prNumber — Get all reviews for a PR
    router.get(
        '/pr/:repoFullName/:prNumber',
        asyncHandler(async (req, res) => {
            const repoFullName = decodeURIComponent(req.params.repoFullName);
            const prNumber = parseInt(req.params.prNumber, 10);

            if (isNaN(prNumber) || prNumber < 1) {
                throw new ValidationError('prNumber must be a positive integer');
            }

            logger.debug('Getting reviews for PR', { repoFullName, prNumber });

            const reviews = reviewsRepo.getByPR(repoFullName, prNumber);

            if (reviews.length === 0) {
                // Return empty structure rather than 404 — the PR may exist
                // but simply has no reviews yet
                res.json({
                    data: {
                        pr_number: prNumber,
                        pr_title: null,
                        pr_author: null,
                        repo_full_name: repoFullName,
                        branch_name: null,
                        reviews: [],
                    },
                });
                return;
            }

            // Use the first review's metadata for the PR-level fields
            const first = reviews[0];

            const reviewSummaries = reviews.map((r) => ({
                id: r.id,
                commit_sha: r.commit_sha,
                commit_message: r.commit_message,
                severity: r.severity,
                summary: r.summary,
                findings_count: r.findings.length,
                status: r.status,
                review_duration_ms: r.review_duration_ms,
                claude_model: r.claude_model,
                created_at: r.created_at,
            }));

            res.json({
                data: {
                    pr_number: first.pr_number,
                    pr_title: first.pr_title,
                    pr_author: first.pr_author,
                    repo_full_name: first.repo_full_name,
                    branch_name: first.branch_name,
                    reviews: reviewSummaries,
                },
            });
        })
    );

    // GET /commit/:commitSha — Get review by commit SHA (prefix match)
    router.get(
        '/commit/:commitSha',
        asyncHandler(async (req, res) => {
            const { commitSha } = req.params;

            if (commitSha.length < 7) {
                throw new ValidationError('Commit SHA must be at least 7 characters');
            }

            logger.debug('Getting review by commit SHA', { commitSha });

            const review = reviewsRepo.getByCommit(commitSha);
            if (!review) {
                throw new NotFoundError('Review', `commit:${commitSha}`);
            }

            res.json({ data: review });
        })
    );

    // POST /trigger — Manually trigger a review
    router.post(
        '/trigger',
        validate(TriggerReviewBodySchema),
        asyncHandler(async (req, res) => {
            const { repo_full_name, pr_number, commit_sha, force } = req.body as z.infer<typeof TriggerReviewBodySchema>;

            logger.info('Manual review trigger', { repo_full_name, pr_number, commit_sha, force });

            // Look up the repository to determine the provider and PR metadata
            const repoRow = db
                .prepare('SELECT provider, default_branch FROM repositories WHERE full_name = ?')
                .get(repo_full_name) as { provider: string; default_branch: string } | undefined;

            const provider: Provider = (repoRow?.provider as Provider) ?? 'github';

            // Check for an existing review of this exact commit
            const existing = reviewsRepo.getByPR(repo_full_name, pr_number)
                .find(r => r.commit_sha === commit_sha);

            if (existing) {
                if (existing.status === 'in_progress') {
                    throw new ValidationError('A review for this commit is already in progress');
                }
                if (existing.status !== 'pending' && !force) {
                    throw new ValidationError(
                        `A review for this commit already exists (status: ${existing.status}). Pass force=true to re-review.`
                    );
                }
                if (force) {
                    // Reset existing review to pending so the reviewer service will reprocess it
                    reviewsRepo.updateStatus(existing.id, 'pending');
                    logger.info('Existing review reset to pending for re-review', {
                        reviewId: existing.id,
                        previousStatus: existing.status,
                    });
                }
            }

            const job: ReviewJob = {
                id: uuid(),
                repoFullName: repo_full_name,
                provider,
                prNumber: pr_number,
                prTitle: existing?.pr_title ?? 'Manual trigger',
                prAuthor: existing?.pr_author ?? 'unknown',
                commitSha: commit_sha,
                commitMessage: existing?.commit_message ?? 'Manual trigger',
                branchName: existing?.branch_name ?? repoRow?.default_branch ?? 'main',
                targetBranch: existing?.target_branch ?? repoRow?.default_branch ?? 'main',
                prState: existing?.pr_state ?? 'open',
                prUrl: existing?.pr_url ?? '',
                enqueuedAt: new Date(),
            };

            queue.enqueue(job);

            logger.info('Review job enqueued via manual trigger', {
                jobId: job.id,
                repo: repo_full_name,
                pr: pr_number,
                commit: commit_sha,
                force,
                reusedReviewId: existing?.id,
            });

            res.status(202).json({
                data: {
                    job_id: job.id,
                    message: existing ? 'Re-review enqueued' : 'Review enqueued',
                    queue_position: queue.size(),
                    review_id: existing?.id ?? null,
                },
            });
        })
    );

    // POST /:id/post-comment — Post the review as a summary comment on the PR
    router.post(
        '/:id/post-comment',
        asyncHandler(async (req, res) => {
            const { id } = req.params;

            const review = reviewsRepo.getById(id);
            if (!review) {
                throw new NotFoundError('Review', id);
            }

            const provider = await deps.providerFactory.getProvider(review.provider);
            const { formatReviewComment } = await import('../../reviewer/comment-formatter.js');
            const body = formatReviewComment(review);

            // Stable marker matching the formatter's heading prefix. Used by the
            // provider to detect and update an existing AutoCodeReview comment
            // rather than creating duplicates on re-review.
            const COMMENT_MARKER = '## 🤖 AutoCodeReview';

            logger.info('Posting review comment', {
                reviewId: id,
                repo: review.repo_full_name,
                pr: review.pr_number,
                provider: review.provider,
            });

            const { url, action } = await provider.postPrComment(
                review.repo_full_name,
                review.pr_number,
                body,
                COMMENT_MARKER,
            );

            res.json({ data: { posted: true, comment_url: url, action } });
        })
    );

    // GET /:id — Get single review by UUID
    // Registered LAST among GET routes so it does not shadow /pr/..., /commit/...
    router.get(
        '/:id',
        asyncHandler(async (req, res) => {
            const { id } = req.params;

            logger.debug('Getting review by ID', { id });

            const review = reviewsRepo.getById(id);
            if (!review) {
                throw new NotFoundError('Review', id);
            }

            res.json({ data: review });
        })
    );

    return router;
}
