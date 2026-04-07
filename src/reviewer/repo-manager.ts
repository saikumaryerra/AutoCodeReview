/**
 * Manages local git clones for Claude CLI to inspect.
 *
 * Each repository is stored as a directory under reposDir, named with
 * double-underscore separators (e.g., "owner__repo"). The manager handles
 * cloning, fetching, checkout, diff generation, and disk cleanup.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { gitClone, gitFetch, gitCheckout, gitDiff } from '../utils/git.js';
import { execCommand } from '../utils/shell.js';
import { createModuleLogger } from '../shared/logger.js';
import type { GitCloneInfo } from '../shared/types.js';

const logger = createModuleLogger('repo-manager');

export class RepoManager {
    constructor(private readonly reposDir: string) {}

    // ── Public API ────────────────────────────────────────────────

    /**
     * Ensures a fresh local copy exists at the correct branch and commit.
     * Clones if needed, fetches latest, and checks out the target commit.
     * Returns the absolute path to the repo directory.
     */
    async prepare(
        repoFullName: string,
        branchName: string,
        commitSha: string,
        cloneUrl: string,
    ): Promise<string> {
        const repoPath = this.getRepoPath(repoFullName);

        await fs.mkdir(this.reposDir, { recursive: true });

        const exists = await this.directoryExists(repoPath);

        if (!exists) {
            logger.info('Cloning repository', { repoFullName, repoPath });
            await gitClone(cloneUrl, repoPath);
        } else {
            logger.info('Repository already cloned, fetching updates', { repoFullName });
        }

        await gitFetch(repoPath);

        // Checkout the branch first, then the exact commit
        try {
            await gitCheckout(repoPath, branchName);
        } catch (err) {
            logger.warn('Branch checkout failed, trying origin-prefixed branch', {
                branchName,
                error: (err as Error).message,
            });
            await gitCheckout(repoPath, `origin/${branchName}`);
        }

        await gitCheckout(repoPath, commitSha);

        logger.info('Repository prepared', { repoFullName, commitSha: commitSha.substring(0, 8) });
        return path.resolve(repoPath);
    }

    /**
     * Generates a unified diff between the target branch and a commit SHA.
     * This is the preferred method for all providers to ensure consistent
     * diff formatting.
     */
    async generateDiff(
        repoFullName: string,
        targetBranch: string,
        commitSha: string,
    ): Promise<string> {
        const repoPath = this.getRepoPath(repoFullName);
        logger.debug('Generating diff', {
            repoFullName,
            targetBranch,
            commitSha: commitSha.substring(0, 8),
        });

        // Use origin-prefixed target branch to ensure we diff against remote
        const diff = await gitDiff(repoPath, `origin/${targetBranch}`, commitSha);
        return diff;
    }

    /**
     * Resets the repo to a clean state (useful after review).
     */
    async cleanup(repoFullName: string): Promise<void> {
        const repoPath = this.getRepoPath(repoFullName);
        const exists = await this.directoryExists(repoPath);
        if (!exists) {
            return;
        }

        // Reset any changes and go back to default branch
        await execCommand('git', ['checkout', '--force', 'HEAD'], {
            cwd: repoPath,
            timeoutMs: 30_000,
        });
        await execCommand('git', ['clean', '-fd'], {
            cwd: repoPath,
            timeoutMs: 30_000,
        });

        logger.debug('Repository cleaned up', { repoFullName });
    }

    /**
     * Runs aggressive garbage collection on a repo clone to reduce disk usage.
     * Returns size before and after in bytes.
     */
    async pruneRepo(repoFullName: string): Promise<{ sizeBefore: number; sizeAfter: number }> {
        const repoPath = this.getRepoPath(repoFullName);

        const sizeBefore = await this.getDirectorySize(repoPath);

        await execCommand('git', ['reflog', 'expire', '--expire=now', '--all'], {
            cwd: repoPath,
            timeoutMs: 120_000,
        });
        await execCommand('git', ['gc', '--aggressive', '--prune=now'], {
            cwd: repoPath,
            timeoutMs: 300_000,
        });
        await execCommand('git', ['repack', '-a', '-d', '--depth=250', '--window=250'], {
            cwd: repoPath,
            timeoutMs: 300_000,
        });

        const sizeAfter = await this.getDirectorySize(repoPath);

        logger.info('Repository pruned', {
            repoFullName,
            sizeBefore,
            sizeAfter,
            saved: sizeBefore - sizeAfter,
        });

        return { sizeBefore, sizeAfter };
    }

    /**
     * Completely removes a repository clone from disk.
     * Returns the number of bytes freed.
     */
    async deleteClone(repoFullName: string): Promise<{ freedBytes: number }> {
        const repoPath = this.getRepoPath(repoFullName);
        const exists = await this.directoryExists(repoPath);

        if (!exists) {
            logger.debug('Clone directory does not exist, nothing to delete', { repoFullName });
            return { freedBytes: 0 };
        }

        const freedBytes = await this.getDirectorySize(repoPath);
        await fs.rm(repoPath, { recursive: true, force: true });

        logger.info('Clone deleted', { repoFullName, freedBytes });
        return { freedBytes };
    }

    /**
     * Lists all repository clones in the repos directory with metadata.
     * Parses directory names back to repo full names and provider.
     */
    async listClones(): Promise<GitCloneInfo[]> {
        const exists = await this.directoryExists(this.reposDir);
        if (!exists) {
            return [];
        }

        const entries = await fs.readdir(this.reposDir, { withFileTypes: true });
        const clones: GitCloneInfo[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const dirPath = path.join(this.reposDir, entry.name);
            const { repoFullName, provider } = this.parseDirName(entry.name);

            let sizeBytes = 0;
            let lastModified = new Date(0);

            try {
                sizeBytes = await this.getDirectorySize(dirPath);
                const stat = await fs.stat(dirPath);
                lastModified = stat.mtime;
            } catch (err) {
                logger.warn('Failed to stat clone directory', {
                    dirName: entry.name,
                    error: (err as Error).message,
                });
            }

            clones.push({
                dirName: entry.name,
                repoFullName,
                provider,
                sizeBytes,
                lastModified,
                isTracked: false, // Caller should cross-reference with repos table
            });
        }

        return clones;
    }

    // ── Private helpers ───────────────────────────────────────────

    /**
     * Converts a repoFullName like "owner/repo" to a filesystem-safe
     * directory path under reposDir, replacing "/" with "__".
     */
    private getRepoPath(repoFullName: string): string {
        const dirName = repoFullName.replace(/\//g, '__');
        return path.join(this.reposDir, dirName);
    }

    /**
     * Parses a directory name back into repoFullName and provider.
     * Directory names use "__" as separator. If the name has 3+ segments
     * and the first matches a known provider, use it; otherwise treat
     * the whole name as the repo identifier with unknown provider.
     */
    private parseDirName(dirName: string): { repoFullName: string; provider: string } {
        const parts = dirName.split('__');

        // Simple case: "owner__repo" -> "owner/repo"
        if (parts.length === 2) {
            return {
                repoFullName: parts.join('/'),
                provider: 'unknown',
            };
        }

        // Check if first segment is a known provider prefix
        const knownProviders = ['github', 'azure_devops', 'azure-devops'];
        if (parts.length >= 3 && knownProviders.includes(parts[0])) {
            return {
                repoFullName: parts.slice(1).join('/'),
                provider: parts[0],
            };
        }

        // Fallback: join all parts with "/"
        return {
            repoFullName: parts.join('/'),
            provider: 'unknown',
        };
    }

    /**
     * Recursively calculates the total size of a directory in bytes.
     */
    private async getDirectorySize(dirPath: string): Promise<number> {
        let totalSize = 0;

        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                totalSize += await this.getDirectorySize(entryPath);
            } else if (entry.isFile()) {
                const stat = await fs.stat(entryPath);
                totalSize += stat.size;
            }
        }

        return totalSize;
    }

    /**
     * Checks whether a directory exists.
     */
    private async directoryExists(dirPath: string): Promise<boolean> {
        try {
            const stat = await fs.stat(dirPath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }
}
