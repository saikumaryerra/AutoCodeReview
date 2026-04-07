import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { createModuleLogger } from '../../shared/logger.js';
import type { ConfigService } from '../../config/config.service.js';

const logger = createModuleLogger('settings-routes');

// ── Zod schemas ───────────────────────────────────────────────────

const UpdateSettingsBodySchema = z.object({
    settings: z.record(z.string(), z.unknown()).refine(
        (obj) => Object.keys(obj).length > 0,
        { message: 'At least one setting must be provided' }
    ),
});

// ── Async handler wrapper ─────────────────────────────────────────

type AsyncHandler = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler): import('express').RequestHandler {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}

// ── Dependencies interface ────────────────────────────────────────

export interface SettingsRouterDeps {
    configService: ConfigService;
}

// ── Router factory ────────────────────────────────────────────────

export function createSettingsRouter(deps: SettingsRouterDeps): Router {
    const router = Router();
    const { configService } = deps;

    // GET / — Return all settings
    router.get(
        '/',
        asyncHandler(async (_req, res) => {
            logger.debug('Getting all settings');

            const settings = configService.getAll();

            res.json({ data: settings });
        })
    );

    // PATCH / — Update settings (partial success model)
    router.patch(
        '/',
        validate(UpdateSettingsBodySchema),
        asyncHandler(async (req, res) => {
            const { settings } = req.body as z.infer<typeof UpdateSettingsBodySchema>;

            logger.info('Updating settings', { keys: Object.keys(settings) });

            const applied: Array<{ key: string; old_value: unknown; new_value: unknown }> = [];
            const rejected: Array<{ key: string; error: string }> = [];

            for (const [key, value] of Object.entries(settings)) {
                try {
                    const oldValue = configService.get(key);
                    configService.set(key, value, 'ui');
                    applied.push({ key, old_value: oldValue, new_value: value });
                    logger.info('Setting applied', { key, old_value: oldValue, new_value: value });
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    rejected.push({ key, error: message });
                    logger.warn('Setting rejected', { key, error: message });
                }
            }

            res.json({ data: { applied, rejected } });
        })
    );

    // POST /:key/reset — Reset a single setting to env default
    router.post(
        '/:key/reset',
        asyncHandler(async (req, res) => {
            const { key } = req.params;

            logger.info('Resetting setting', { key });

            const { previousValue, restoredValue } = configService.reset(key);

            logger.info('Setting reset', { key, previousValue, restoredValue });

            res.json({
                data: {
                    key,
                    previous_value: previousValue,
                    restored_value: restoredValue,
                    source: 'env_default' as const,
                },
            });
        })
    );

    return router;
}
