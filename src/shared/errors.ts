export class AppError extends Error {
    constructor(
        message: string,
        public statusCode: number = 500,
        public code: string = 'INTERNAL_ERROR'
    ) {
        super(message);
        this.name = 'AppError';
    }
}

export class ValidationError extends AppError {
    constructor(message: string) {
        super(message, 400, 'VALIDATION_ERROR');
        this.name = 'ValidationError';
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string, identifier: string) {
        super(`${resource} not found: ${identifier}`, 404, 'NOT_FOUND');
        this.name = 'NotFoundError';
    }
}

/** HTTP statuses a git provider returns when it rejects our credentials. */
export const PROVIDER_AUTH_FAILURE_STATUSES: readonly number[] = [401, 403];

/**
 * The git provider rejected the configured access token (expired, revoked,
 * malformed, or missing scopes). Surfaced as 502 — the upstream refused us,
 * the client's request itself was fine.
 */
export class ProviderAuthError extends AppError {
    constructor(providerLabel: string, target: string) {
        super(
            `${providerLabel} rejected the access token for ${target}. ` +
            'Check that the token is valid, not expired, has the required scopes, ' +
            'and has no leading/trailing whitespace.',
            502,
            'PROVIDER_AUTH_FAILED',
        );
        this.name = 'ProviderAuthError';
    }
}

export class ConflictError extends AppError {
    constructor(message: string) {
        super(message, 409, 'CONFLICT');
        this.name = 'ConflictError';
    }
}
