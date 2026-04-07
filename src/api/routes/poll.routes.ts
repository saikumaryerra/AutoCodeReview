import { Router } from 'express';
import { ConflictError } from '../../shared/errors.js';
import { createModuleLogger } from '../../shared/logger.js';

const logger = createModuleLogger('poll-routes');

// ── Async handler wrapper ─────────────────────────────────────────

type AsyncHandler = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler): import('express').RequestHandler {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}

// ── Dependencies interface ────────────────────────────────────────

export interface PollResult {
    repos_polled: number;
    new_commits_found: number;
    reviews_enqueued: number;
    duration_ms: number;
    details: Array<{ repo: string; new_commits: number }>;
}

export interface PollerServiceDeps {
    triggerManualPoll(): Promise<PollResult>;
}

export interface PollRouterDeps {
    pollerService: PollerServiceDeps;
}

// ── Router factory ────────────────────────────────────────────────

export function createPollRouter(deps: PollRouterDeps): Router {
    const router = Router();
    const { pollerService } = deps;

    // POST / — Trigger manual poll
    router.post(
        '/',
        asyncHandler(async (_req, res) => {
            logger.info('Manual poll triggered');

            try {
                const result = await pollerService.triggerManualPoll();

                logger.info('Manual poll completed', {
                    repos_polled: result.repos_polled,
                    new_commits_found: result.new_commits_found,
                    reviews_enqueued: result.reviews_enqueued,
                    duration_ms: result.duration_ms,
                });

                res.json({ data: result });
            } catch (err) {
                // If it's already a ConflictError, re-throw so the error handler picks it up
                if (err instanceof ConflictError) {
                    throw err;
                }
                throw err;
            }
        })
    );

    return router;
}
