import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../shared/errors.js';
import { createModuleLogger } from '../../shared/logger.js';

const logger = createModuleLogger('error-handler');

/**
 * Global Express error-handling middleware.
 *
 * Must be registered LAST in the middleware chain (after all routes).
 * Express identifies error handlers by their 4-parameter signature.
 */
export function errorHandler(
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
): void {
    // ── AppError (domain errors with known status codes) ──────────
    if (err instanceof AppError) {
        logger.warn('Application error', {
            code: err.code,
            statusCode: err.statusCode,
            message: err.message,
        });

        res.status(err.statusCode).json({
            error: err.message,
            code: err.code,
        });
        return;
    }

    // ── ZodError (validation failures from schema parsing) ────────
    if (err instanceof ZodError) {
        const messages = err.issues.map(
            (issue) => `${issue.path.join('.')}: ${issue.message}`
        );
        const formatted = messages.join('; ');

        logger.warn('Validation error', { issues: messages });

        res.status(400).json({
            error: formatted,
            code: 'VALIDATION_ERROR',
        });
        return;
    }

    // ── Unknown / unexpected errors ───────────────────────────────
    logger.error('Unhandled error', {
        name: err.name,
        message: err.message,
        stack: err.stack,
    });

    const isProduction = process.env.NODE_ENV === 'production';

    res.status(500).json({
        error: isProduction ? 'Internal server error' : err.message,
        code: 'INTERNAL_ERROR',
    });
}
