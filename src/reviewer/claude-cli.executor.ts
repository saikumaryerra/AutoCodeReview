/**
 * Spawns the Claude CLI process against a local repo checkout and captures
 * the structured JSON output.
 *
 * The CLI is invoked in --print mode with read-only tools so Claude can
 * inspect source files but cannot modify anything.
 */

import { execCommand } from '../utils/shell.js';
import { createModuleLogger } from '../shared/logger.js';

const logger = createModuleLogger('claude-cli');

// ── Public types ──────────────────────────────────────────────────

export interface ClaudeCliResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    model: string | null;
}

// ── Executor class ────────────────────────────────────────────────

export class ClaudeCliExecutor {
    constructor(
        private readonly cliPath: string,
        private readonly timeoutSeconds: number,
        private readonly model: string | undefined,
    ) {}

    /**
     * Executes a review by spawning the Claude CLI with the repo as the
     * working directory. The prompt is passed via --prompt and the output
     * is captured as JSON.
     */
    async executeReview(repoPath: string, prompt: string): Promise<ClaudeCliResult> {
        const args = this.buildArgs();

        logger.info('Spawning Claude CLI', {
            repoPath,
            model: this.model ?? 'default',
            timeoutSeconds: this.timeoutSeconds,
            argsCount: args.length,
        });

        const result = await execCommand(this.cliPath, args, {
            cwd: repoPath,
            timeoutMs: this.timeoutSeconds * 1000,
            stdin: prompt,
        });

        const model = this.extractModel(result.stdout);

        const cliResult: ClaudeCliResult = {
            success: result.exitCode === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            model,
        };

        if (cliResult.success) {
            logger.info('Claude CLI completed successfully', {
                durationMs: result.durationMs,
                model,
                stdoutLength: result.stdout.length,
            });
        } else {
            logger.error('Claude CLI failed', {
                exitCode: result.exitCode,
                durationMs: result.durationMs,
                stderr: result.stderr.substring(0, 500),
            });
        }

        return cliResult;
    }

    /**
     * Builds the argument list for the Claude CLI invocation.
     */
    private buildArgs(): string[] {
        const args: string[] = [
            '--print',
            '--output-format', 'json',
            '--max-turns', '8',
            '--allowedTools', 'Read,Glob,Grep',
        ];

        if (this.model) {
            args.push('--model', this.model);
        }

        return args;
    }

    /**
     * Attempts to extract the model identifier from the Claude CLI JSON
     * output envelope.
     */
    private extractModel(stdout: string): string | null {
        try {
            const envelope = JSON.parse(stdout);
            if (typeof envelope.model === 'string') {
                return envelope.model;
            }
        } catch {
            // stdout may not be valid JSON (e.g., on timeout/crash)
        }
        return null;
    }
}
