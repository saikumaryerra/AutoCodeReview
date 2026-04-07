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

export class ConflictError extends AppError {
    constructor(message: string) {
        super(message, 409, 'CONFLICT');
        this.name = 'ConflictError';
    }
}
