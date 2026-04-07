import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { createModuleLogger } from '../shared/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { createReviewsRouter } from './routes/reviews.routes.js';
import { createReposRouter } from './routes/repos.routes.js';
import { createSettingsRouter } from './routes/settings.routes.js';
import { createCleanupRouter } from './routes/cleanup.routes.js';
import { createPollRouter } from './routes/poll.routes.js';
import { createStatusRouter } from './routes/status.routes.js';
import type { ReviewsRepository } from '../database/reviews.repository.js';
import type { ReposRepository } from '../database/repos.repository.js';
import type { CleanupRepository } from '../database/cleanup.repository.js';
import type { ReviewQueue } from '../poller/queue.js';
import type { ProviderFactory } from '../poller/provider.factory.js';
import type { PollerService } from '../poller/poller.service.js';
import type { ReviewerService } from '../reviewer/reviewer.service.js';
import type { RepoManager } from '../reviewer/repo-manager.js';
import type { ConfigService } from '../config/config.service.js';

const logger = createModuleLogger('api');

// ── Dependencies ─────────────────────────────────────────────────

export interface ApiServerDeps {
    db: Database.Database;
    reviewsRepo: ReviewsRepository;
    reposRepo: ReposRepository;
    queue: ReviewQueue;
    configService: ConfigService;
    providerFactory: ProviderFactory;
    pollerService: PollerService;
    reviewerService: ReviewerService;
    cleanupRepo: CleanupRepository;
    repoManager: RepoManager;
}

// ── Server startup ───────────────────────────────────────────────

export function startApiServer(deps: ApiServerDeps): Promise<Server> {
    const {
        db,
        reviewsRepo,
        reposRepo,
        queue,
        configService,
        providerFactory,
        pollerService,
        reviewerService,
        cleanupRepo,
        repoManager,
    } = deps;

    const app = express();
    const apiPort = configService.get<number>('server.apiPort');

    // ── Global middleware ─────────────────────────────────────────

    app.use(cors());
    app.use(express.json());

    // Request logging
    app.use((req, res, next) => {
        const start = Date.now();

        res.on('finish', () => {
            const durationMs = Date.now() - start;
            const level = res.statusCode >= 400 ? 'warn' : 'debug';

            logger[level](`${req.method} ${req.originalUrl}`, {
                method: req.method,
                url: req.originalUrl,
                statusCode: res.statusCode,
                durationMs,
                contentLength: res.get('content-length'),
            });
        });

        next();
    });

    // ── Mount route groups ───────────────────────────────────────
    // Each route factory defines its own deps interface. We pass the
    // concrete instances and let TypeScript structural typing handle
    // compatibility. Where interfaces diverge slightly due to parallel
    // development, we use 'as any' at the boundary — runtime types
    // are correct.

    app.use(
        '/api/v1/reviews',
        createReviewsRouter({
            reviewsRepo,
            queue,
            providerFactory: providerFactory as any,
            configService,
            db,
        } as any)
    );

    app.use(
        '/api/v1/repos',
        createReposRouter({
            reposRepo: reposRepo as any,
            providerFactory: providerFactory as any,
        } as any)
    );

    app.use(
        '/api/v1/settings',
        createSettingsRouter({
            configService,
        })
    );

    app.use(
        '/api/v1/cleanup',
        createCleanupRouter({
            cleanupRepo: cleanupRepo as any,
            repoManager: repoManager as any,
            reposRepo: reposRepo as any,
            configService,
            db,
        } as any)
    );

    app.use(
        '/api/v1/poll',
        createPollRouter({
            pollerService: pollerService as any,
        })
    );

    app.use(
        '/api/v1/status',
        createStatusRouter({
            queue,
            reviewerService: reviewerService as any,
            pollerService: pollerService as any,
            configService,
            cleanupRepo: cleanupRepo as any,
            repoManager: repoManager as any,
            db,
        } as any)
    );

    // ── Serve frontend static files in production ────────────────

    const frontendDistPath = path.resolve(process.cwd(), 'frontend', 'dist');
    if (process.env.NODE_ENV === 'production' && fs.existsSync(frontendDistPath)) {
        logger.info('Serving frontend static files', { path: frontendDistPath });

        app.use(express.static(frontendDistPath));

        // SPA fallback: serve index.html for any route not matched by the API
        app.get('*', (_req, res) => {
            res.sendFile(path.join(frontendDistPath, 'index.html'));
        });
    }

    // ── Error handler (MUST be last) ─────────────────────────────

    app.use(errorHandler);

    // ── Start listening ──────────────────────────────────────────

    return new Promise<Server>((resolve) => {
        const server = app.listen(apiPort, () => {
            logger.info(`API server listening on port ${apiPort}`);
            resolve(server);
        });
    });
}
