import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { validate } from '../middleware/validate.js';
import { NotFoundError } from '../../shared/errors.js';
import { createModuleLogger } from '../../shared/logger.js';
import type Database from 'better-sqlite3';
import type { Provider, Repository } from '../../shared/types.js';

const logger = createModuleLogger('repos-routes');

// ── Zod schemas ───────────────────────────────────────────────────

const AddRepoBodySchema = z.object({
    full_name: z.string().min(1).regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format'),
    provider: z.enum(['github', 'azure_devops']).optional(),
    default_branch: z.string().min(1).default('main'),
    org_url: z.string().url().optional(),
});

const UpdateRepoBodySchema = z.object({
    is_active: z.boolean().optional(),
    default_branch: z.string().min(1).optional(),
}).refine(
    (data) => data.is_active !== undefined || data.default_branch !== undefined,
    { message: 'At least one field (is_active, default_branch) must be provided' }
);

// ── Async handler wrapper ─────────────────────────────────────────

type AsyncHandler = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler): import('express').RequestHandler {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}

// ── Row types from SQLite ─────────────────────────────────────────

interface RepoRow {
    id: string;
    full_name: string;
    provider: string;
    org_url: string | null;
    default_branch: string;
    added_at: string;
    last_polled_at: string | null;
    is_active: number;
}

interface RepoWithCountRow extends RepoRow {
    review_count: number;
}

// ── Dependencies interface ────────────────────────────────────────

export interface ReposRouterDeps {
    db: Database.Database;
    providerFactory: { getProvider(name: Provider): unknown };
}

// ── Router factory ────────────────────────────────────────────────

export function createReposRouter(deps: ReposRouterDeps): Router {
    const router = Router();
    const db = deps.db;

    // GET / — List all tracked repos with review_count
    router.get(
        '/',
        asyncHandler(async (_req, res) => {
            logger.debug('Listing repositories');

            const rows = db
                .prepare(`
                    SELECT
                        r.*,
                        COALESCE(cnt.review_count, 0) AS review_count
                    FROM repositories r
                    LEFT JOIN (
                        SELECT repo_full_name, COUNT(*) AS review_count
                        FROM reviews
                        GROUP BY repo_full_name
                    ) cnt ON cnt.repo_full_name = r.full_name
                    ORDER BY r.added_at DESC
                `)
                .all() as RepoWithCountRow[];

            const data = rows.map((row) => ({
                id: row.id,
                full_name: row.full_name,
                provider: row.provider,
                org_url: row.org_url,
                default_branch: row.default_branch,
                added_at: row.added_at,
                last_polled_at: row.last_polled_at,
                is_active: Boolean(row.is_active),
                review_count: row.review_count,
            }));

            res.json({ data });
        })
    );

    // POST / — Add a new repo
    router.post(
        '/',
        validate(AddRepoBodySchema),
        asyncHandler(async (req, res) => {
            const body = req.body as z.infer<typeof AddRepoBodySchema>;

            logger.info('Adding repository', { full_name: body.full_name, provider: body.provider });

            // Detect provider if not specified
            const provider: Provider = body.provider ?? 'github';

            const id = uuid();
            const now = new Date().toISOString();

            db.prepare(`
                INSERT INTO repositories (id, full_name, provider, org_url, default_branch, added_at, is_active)
                VALUES (@id, @full_name, @provider, @org_url, @default_branch, @added_at, 1)
            `).run({
                id,
                full_name: body.full_name,
                provider,
                org_url: body.org_url ?? null,
                default_branch: body.default_branch,
                added_at: now,
            });

            const repo = {
                id,
                full_name: body.full_name,
                provider,
                org_url: body.org_url ?? null,
                default_branch: body.default_branch,
                added_at: now,
                last_polled_at: null,
                is_active: true,
            };

            logger.info('Repository added', { id, full_name: body.full_name });

            res.status(201).json({ data: repo });
        })
    );

    // PATCH /:id — Update repo
    router.patch(
        '/:id',
        validate(UpdateRepoBodySchema),
        asyncHandler(async (req, res) => {
            const { id } = req.params;
            const body = req.body as z.infer<typeof UpdateRepoBodySchema>;

            logger.debug('Updating repository', { id, updates: body });

            // Check existence
            const existing = db
                .prepare('SELECT id FROM repositories WHERE id = ?')
                .get(id) as { id: string } | undefined;

            if (!existing) {
                throw new NotFoundError('Repository', id);
            }

            // Build dynamic SET clause
            const setClauses: string[] = [];
            const params: Record<string, unknown> = { id };

            if (body.is_active !== undefined) {
                setClauses.push('is_active = @is_active');
                params.is_active = body.is_active ? 1 : 0;
            }
            if (body.default_branch !== undefined) {
                setClauses.push('default_branch = @default_branch');
                params.default_branch = body.default_branch;
            }

            db.prepare(`UPDATE repositories SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

            // Return updated row
            const updated = db
                .prepare('SELECT * FROM repositories WHERE id = ?')
                .get(id) as RepoRow;

            res.json({
                data: {
                    ...updated,
                    is_active: Boolean(updated.is_active),
                },
            });
        })
    );

    // DELETE /:id — Delete repo
    router.delete(
        '/:id',
        asyncHandler(async (req, res) => {
            const { id } = req.params;

            logger.info('Deleting repository', { id });

            const existing = db
                .prepare('SELECT id, full_name FROM repositories WHERE id = ?')
                .get(id) as { id: string; full_name: string } | undefined;

            if (!existing) {
                throw new NotFoundError('Repository', id);
            }

            db.prepare('DELETE FROM repositories WHERE id = ?').run(id);

            logger.info('Repository deleted', { id, full_name: existing.full_name });

            res.status(204).send();
        })
    );

    return router;
}
