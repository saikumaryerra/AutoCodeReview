import { execCommand } from './shell.js';
import { createModuleLogger } from '../shared/logger.js';

const logger = createModuleLogger('git');

export async function gitClone(url: string, targetDir: string): Promise<void> {
    logger.debug(`Cloning ${url.replace(/\/\/[^@]+@/, '//***@')} to ${targetDir}`);
    const result = await execCommand('git', ['clone', '--depth', '50', url, targetDir], {
        timeoutMs: 300_000,
    });
    if (result.exitCode !== 0) {
        throw new Error(`git clone failed (exit ${result.exitCode}): ${result.stderr}`);
    }
}

export async function gitFetch(repoDir: string): Promise<void> {
    const result = await execCommand('git', ['fetch', '--all', '--prune'], {
        cwd: repoDir,
        timeoutMs: 120_000,
    });
    if (result.exitCode !== 0) {
        throw new Error(`git fetch failed (exit ${result.exitCode}): ${result.stderr}`);
    }
}

export async function gitCheckout(repoDir: string, ref: string): Promise<void> {
    // First try to checkout directly
    let result = await execCommand('git', ['checkout', ref], {
        cwd: repoDir,
        timeoutMs: 30_000,
    });

    if (result.exitCode !== 0) {
        // Try fetching the specific ref and checkout again
        await execCommand('git', ['fetch', 'origin', ref], {
            cwd: repoDir,
            timeoutMs: 60_000,
        });
        result = await execCommand('git', ['checkout', ref], {
            cwd: repoDir,
            timeoutMs: 30_000,
        });
        if (result.exitCode !== 0) {
            throw new Error(`git checkout ${ref} failed: ${result.stderr}`);
        }
    }
}

export async function gitDiff(
    repoDir: string,
    targetBranch: string,
    commitSha: string
): Promise<string> {
    const result = await execCommand(
        'git',
        ['diff', `${targetBranch}...${commitSha}`],
        { cwd: repoDir, timeoutMs: 60_000 }
    );
    if (result.exitCode !== 0) {
        throw new Error(`git diff failed: ${result.stderr}`);
    }
    return result.stdout;
}

export async function gitPull(repoDir: string, branch: string): Promise<void> {
    const result = await execCommand('git', ['pull', 'origin', branch], {
        cwd: repoDir,
        timeoutMs: 120_000,
    });
    if (result.exitCode !== 0) {
        throw new Error(`git pull failed: ${result.stderr}`);
    }
}

export async function gitGetCurrentBranch(repoDir: string): Promise<string> {
    const result = await execCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: repoDir,
        timeoutMs: 10_000,
    });
    return result.stdout.trim();
}
