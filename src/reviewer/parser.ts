/**
 * Parses raw Claude CLI JSON output into a structured ParsedReview.
 *
 * Claude CLI with --output-format json returns an envelope with a `result`
 * field containing the text response. The text response should be the JSON
 * review object we requested in the prompt.
 *
 * Parsing strategy:
 * 1. Parse the outer envelope.
 * 2. Extract the `result` field (string containing the review JSON).
 * 3. Strip markdown code fences if present.
 * 4. Validate the inner JSON against a Zod schema.
 * 5. On any failure, return a safe fallback with severity "warning".
 */

import { z } from 'zod';
import type { Finding } from '../shared/types.js';
import { createModuleLogger } from '../shared/logger.js';

const logger = createModuleLogger('parser');

// ── Public types ──────────────────────────────────────────────────

export interface ParsedReview {
    summary: string;
    severity: 'critical' | 'warning' | 'info' | 'clean';
    findings: Finding[];
    model: string | null;
}

// ── Zod schemas ───────────────────────────────────────────────────

const FindingSchema = z.object({
    type: z.enum(['bug', 'security', 'performance', 'style', 'maintainability', 'suggestion', 'praise']),
    severity: z.enum(['critical', 'warning', 'info', 'praise']),
    file: z.string(),
    line_start: z.number().nullable().default(null),
    line_end: z.number().nullable().default(null),
    title: z.string(),
    description: z.string(),
    suggestion: z.string().nullable().default(null),
    code_snippet: z.string().nullable().default(null),
});

const ReviewOutputSchema = z.object({
    summary: z.string(),
    severity: z.enum(['critical', 'warning', 'info', 'clean']),
    findings: z.array(FindingSchema),
});

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Strips markdown code fences (```json ... ```) from a string,
 * returning the inner content.
 */
function stripCodeFences(text: string): string {
    // Match ```json ... ``` or ``` ... ``` blocks
    const fencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/;
    const trimmed = text.trim();
    const match = fencePattern.exec(trimmed);
    if (match) {
        return match[1].trim();
    }
    return trimmed;
}

/**
 * Attempts to extract a JSON object from a string that may contain
 * surrounding text, code fences, or other noise.
 */
function extractJsonFromText(text: string): string {
    // First try stripping code fences
    let cleaned = stripCodeFences(text);

    // If the result starts with '{', it's likely our JSON
    if (cleaned.startsWith('{')) {
        return cleaned;
    }

    // Try to find JSON object boundaries in the text
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        return text.substring(firstBrace, lastBrace + 1);
    }

    return cleaned;
}

/**
 * Creates a fallback ParsedReview when parsing fails.
 */
function createFallback(reason: string, model: string | null): ParsedReview {
    logger.warn('Falling back to default review output', { reason });
    return {
        summary: `Review failed: ${reason}`,
        severity: 'warning',
        findings: [],
        model,
    };
}

// ── Main parser ───────────────────────────────────────────────────

export function parseClaudeOutput(rawOutput: string): ParsedReview {
    let model: string | null = null;

    // Step 1: Try to parse the raw output as JSON (Claude CLI envelope)
    let envelope: Record<string, unknown>;
    try {
        envelope = JSON.parse(rawOutput);
    } catch {
        logger.warn('Raw output is not valid JSON, attempting text extraction');
        // The raw output itself might be the review text (non-envelope format)
        return parseInnerReview(rawOutput, model);
    }

    // Step 2: Extract model from the envelope if available
    if (typeof envelope.model === 'string') {
        model = envelope.model;
    }

    // Step 2.5: Check for explicit error in the envelope (is_error: true)
    if (envelope.is_error === true && typeof envelope.result === 'string') {
        const errorMessage = envelope.result as string;

        // Check for authentication-related errors
        if (
            errorMessage.includes('401') ||
            errorMessage.includes('Failed to authenticate') ||
            errorMessage.includes('Invalid authentication credentials') ||
            errorMessage.includes('Authentication error')
        ) {
            logger.error('Claude CLI authentication failed', {
                errorMessage: errorMessage.substring(0, 200),
                envelopeSubtype: envelope.subtype,
            });
            return {
                summary: 'Review failed: Authentication error. Please check Claude CLI credentials.',
                severity: 'critical',
                findings: [],
                model,
            };
        }

        // Check for rate limit / quota errors
        if (
            errorMessage.includes('429') ||
            errorMessage.includes('rate limit') ||
            errorMessage.includes('quota')
        ) {
            logger.error('Claude API rate limit or quota exceeded', {
                errorMessage: errorMessage.substring(0, 200),
            });
            return createFallback('Claude API rate limit exceeded — retrying later', model);
        }

        // Check for timeout or connection errors
        if (
            errorMessage.includes('timeout') ||
            errorMessage.includes('connection') ||
            errorMessage.includes('ECONNREFUSED')
        ) {
            logger.error('Claude CLI connection error', {
                errorMessage: errorMessage.substring(0, 200),
            });
            return createFallback('Connection error to Claude API — retrying later', model);
        }

        // Generic error in envelope
        logger.error('Claude CLI returned error', {
            errorMessage: errorMessage.substring(0, 200),
            envelopeSubtype: envelope.subtype,
        });
        return createFallback(`Claude CLI error: ${errorMessage.substring(0, 100)}`, model);
    }

    // Step 3: Extract the `result` field from the Claude CLI envelope
    const result = envelope.result;
    if (result === undefined || result === null || result === '') {
        const subtype = envelope.subtype as string | undefined;
        if (subtype === 'error_max_turns') {
            return createFallback('Claude hit max turns limit before producing review output — increase --max-turns', model);
        }
        return createFallback('No "result" field in Claude CLI envelope', model);
    }

    // The result could be a string or a nested object
    if (typeof result === 'string') {
        return parseInnerReview(result, model);
    }

    // If result is already an object, try to validate it directly
    if (typeof result === 'object') {
        return validateReviewObject(result as Record<string, unknown>, model);
    }

    return createFallback(`Unexpected result type: ${typeof result}`, model);
}

/**
 * Parses the inner review content from a string (handles code fences, etc).
 */
function parseInnerReview(text: string, model: string | null): ParsedReview {
    const jsonStr = extractJsonFromText(text);

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        return createFallback('Inner review content is not valid JSON', model);
    }

    if (typeof parsed !== 'object' || parsed === null) {
        return createFallback('Parsed inner content is not an object', model);
    }

    return validateReviewObject(parsed as Record<string, unknown>, model);
}

/**
 * Validates a parsed object against the review Zod schema.
 */
function validateReviewObject(obj: Record<string, unknown>, model: string | null): ParsedReview {
    const result = ReviewOutputSchema.safeParse(obj);
    if (!result.success) {
        logger.warn('Review output failed Zod validation', {
            errors: result.error.issues.map(i => ({
                path: i.path.join('.'),
                message: i.message,
            })),
        });
        return createFallback(
            `Zod validation failed: ${result.error.issues.map(i => i.message).join('; ')}`,
            model,
        );
    }

    return {
        summary: result.data.summary,
        severity: result.data.severity,
        findings: result.data.findings as Finding[],
        model,
    };
}
