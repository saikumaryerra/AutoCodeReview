import { spawn } from 'child_process';
import { createModuleLogger } from '../shared/logger.js';

const logger = createModuleLogger('shell');

export interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
}

export async function execCommand(
    command: string,
    args: string[],
    options: {
        cwd?: string;
        timeoutMs?: number;
        env?: Record<string, string>;
        stdin?: string;
    } = {}
): Promise<ExecResult> {
    const { cwd, timeoutMs = 120_000, env, stdin } = options;
    const start = Date.now();

    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            cwd,
            env: env ? { ...process.env, ...env } : process.env,
            stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        });

        if (stdin !== undefined && proc.stdin) {
            proc.stdin.write(stdin);
            proc.stdin.end();
        }

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        proc.stdout!.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
        proc.stderr!.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

        let killed = false;
        const timer = setTimeout(() => {
            killed = true;
            proc.kill('SIGTERM');
            setTimeout(() => {
                if (!proc.killed) {
                    proc.kill('SIGKILL');
                }
            }, 5000);
        }, timeoutMs);

        proc.on('close', (exitCode) => {
            clearTimeout(timer);
            const durationMs = Date.now() - start;
            const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
            const stderr = Buffer.concat(stderrChunks).toString('utf-8');

            if (killed) {
                resolve({
                    stdout,
                    stderr: stderr + '\nProcess killed: timeout exceeded',
                    exitCode: exitCode ?? 1,
                    durationMs,
                });
            } else {
                resolve({ stdout, stderr, exitCode: exitCode ?? 0, durationMs });
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Failed to spawn ${command}: ${err.message}`));
        });
    });
}
