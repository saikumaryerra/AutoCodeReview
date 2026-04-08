import { execCommand } from './shell.js';
import { createModuleLogger } from '../shared/logger.js';

const logger = createModuleLogger('git');

export async function gitClone(url: string, targetDir: string): Promise<void> {
    logger.debug(`Cloning ${url.replace(/\/\/[^@]+@/, '//***@')} to ${targetDir}`);
    // Use --no-single-branch so all remote branch refs are fetched (not just the default).
    // This is required for checking out PR branches later.
    const result = await execCommand('git', ['clone', '--depth', '50', '--no-single-branch', url, targetDir], {
        timeoutMs: 300_000,
    });
    if (result.exitCode !== 0) {
        throw new Error(`git clone failed (exit ${result.exitCode}): ${result.stderr}`);
    }
}

export async function gitFetch(repoDir: string): Promise<void> {
    // Ensure the remote is configured to fetch all branches, not just
    // the default one (shallow single-branch clones set a narrow refspec).
    await execCommand('git', ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'], {
        cwd: repoDir,
        timeoutMs: 10_000,
    });

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
        // On shallow clones the commit may not exist locally yet.
        // Deepen the fetch to include the specific ref.
        await execCommand('git', ['fetch', 'origin', ref, '--depth=50'], {
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

export async function gitGetDefaultBranch(repoDir: string): Promise<string> {
    const result = await execCommand('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: repoDir,
        timeoutMs: 10_000,
    });
    if (result.exitCode === 0) {
        // Output is like "refs/remotes/origin/master" — extract the branch name
        return result.stdout.trim().replace('refs/remotes/origin/', '');
    }
    return 'main'; // fallback
}
