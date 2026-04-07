import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { ValidationError } from '../../shared/errors.js';

/**
 * Returns Express middleware that validates `req.body` against the given
 * Zod schema. On success the body is replaced with the parsed (and
 * potentially transformed/defaulted) data. On failure a ValidationError
 * is thrown so the global error handler can format it.
 */
export function validate(schema: ZodSchema) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            const messages = result.error.issues.map(
                (issue) => `${issue.path.join('.')}: ${issue.message}`
            );
            throw new ValidationError(messages.join('; '));
        }

        req.body = result.data;
        next();
    };
}

/**
 * Returns Express middleware that validates `req.query` against the given
 * Zod schema. Query parameters arrive as strings, so the schema should
 * use `.coerce` or `.transform` where numeric/boolean values are expected.
 */
export function validateQuery(schema: ZodSchema) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.query);

        if (!result.success) {
            const messages = result.error.issues.map(
                (issue) => `${issue.path.join('.')}: ${issue.message}`
            );
            throw new ValidationError(messages.join('; '));
        }

        req.query = result.data;
        next();
    };
}
