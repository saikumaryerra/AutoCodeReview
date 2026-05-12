import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate.js';
import { createModuleLogger } from '../../shared/logger.js';
import type { ReviewsRepository } from '../../database/reviews.repository.js';

const logger = createModuleLogger('prs-routes');

const ListPRsQuerySchema = z.object({
    repo: z.string().optional(),
    provider: z.enum(['github', 'azure_devops']).optional(),
    severity: z.enum(['critical', 'warning', 'info', 'clean']).optional(),
    pr_state: z.enum(['open', 'closed', 'merged']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['latest_review_at', 'pr_number', 'severity']).default('latest_review_at'),
    order: z.enum(['asc', 'desc']).default('desc'),
});

export interface PRsRouterDeps {
    reviewsRepo: ReviewsRepository;
}

export function createPRsRouter(deps: PRsRouterDeps): Router {
    const router = Router();
    const { reviewsRepo } = deps;

    // GET / — List PRs grouped from reviews, one row per (repo, pr_number)
    router.get(
        '/',
        validateQuery(ListPRsQuerySchema),
        (req, res) => {
            const filters = req.query as unknown as z.infer<typeof ListPRsQuerySchema>;
            logger.debug('Listing PRs (grouped)', { filters });
            const result = reviewsRepo.listGroupedByPR(filters);
            res.json(result);
        }
    );

    return router;
}
