import type Database from 'better-sqlite3';
import type { Repository, Provider } from '../shared/types.js';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('repos-repo');

// ── Row types ───────────────────────────────────────────────────

/** Raw SQLite row (is_active is INTEGER 0|1). */
interface RepoRow {
    id: string;
    full_name: string;
    provider: string;
    org_url: string | null;
    default_branch: string;
    added_at: string;
    last_polled_at: string | null;
    is_active: number;
}

/** Extended row returned by listAll (includes joined review_count). */
interface RepoRowWithCount extends RepoRow {
    review_count: number;
}

/** Domain type extended with review_count for list responses. */
export interface RepositoryWithCount extends Repository {
    review_count: number;
}

// ── Parsing helpers ─────────────────────────────────────────────

function parseRepoRow(row: RepoRow): Repository {
    return {
        ...row,
        provider: row.provider as Provider,
        is_active: row.is_active === 1,
    };
}

function parseRepoRowWithCount(row: RepoRowWithCount): RepositoryWithCount {
    return {
        ...parseRepoRow(row),
        review_count: row.review_count,
    };
}

// ── Repository class ────────────────────────────────────────────

export class ReposRepository {
    constructor(private db: Database.Database) {}

    /**
     * Insert a new tracked repository.
     */
    insert(repo: Repository): void {
        const stmt = this.db.prepare(`
            INSERT INTO repositories (
                id, full_name, provider, org_url, default_branch,
                added_at, last_polled_at, is_active
            ) VALUES (
                @id, @full_name, @provider, @org_url, @default_branch,
                @added_at, @last_polled_at, @is_active
            )
        `);

        stmt.run({
            id: repo.id,
            full_name: repo.full_name,
            provider: repo.provider,
            org_url: repo.org_url,
            default_branch: repo.default_branch,
            added_at: repo.added_at,
            last_polled_at: repo.last_polled_at,
            is_active: repo.is_active ? 1 : 0,
        });

        log.debug('Repository inserted', { id: repo.id, full_name: repo.full_name });
    }

    /**
     * Get a single repository by UUID.
     */
    getById(id: string): Repository | null {
        const row = this.db
            .prepare('SELECT * FROM repositories WHERE id = ?')
            .get(id) as RepoRow | undefined;
        return row ? parseRepoRow(row) : null;
    }

    /**
     * Get a single repository by its full_name (e.g. "owner/repo").
     */
    getByFullName(fullName: string): Repository | null {
        const row = this.db
            .prepare('SELECT * FROM repositories WHERE full_name = ?')
            .get(fullName) as RepoRow | undefined;
        return row ? parseRepoRow(row) : null;
    }

    /**
     * List all repositories with a joined review_count.
     */
    listAll(): RepositoryWithCount[] {
        const rows = this.db
            .prepare(`
                SELECT r.*,
                       COALESCE(rc.cnt, 0) AS review_count
                FROM repositories r
                LEFT JOIN (
                    SELECT repo_full_name, COUNT(*) AS cnt
                    FROM reviews
                    GROUP BY repo_full_name
                ) rc ON rc.repo_full_name = r.full_name
                ORDER BY r.added_at DESC
            `)
            .all() as RepoRowWithCount[];

        return rows.map(parseRepoRowWithCount);
    }

    /**
     * List only active repositories (is_active = 1).
     */
    listActive(): Repository[] {
        const rows = this.db
            .prepare('SELECT * FROM repositories WHERE is_active = 1 ORDER BY full_name ASC')
            .all() as RepoRow[];

        return rows.map(parseRepoRow);
    }

    /**
     * Partial update of a repository.
     * Only the supplied fields are modified; others are left untouched.
     */
    update(
        id: string,
        data: Partial<Pick<Repository, 'is_active' | 'default_branch' | 'last_polled_at'>>
    ): void {
        const sets: string[] = [];
        const params: Record<string, unknown> = { id };

        if (data.is_active !== undefined) {
            sets.push('is_active = @is_active');
            params.is_active = data.is_active ? 1 : 0;
        }
        if (data.default_branch !== undefined) {
            sets.push('default_branch = @default_branch');
            params.default_branch = data.default_branch;
        }
        if (data.last_polled_at !== undefined) {
            sets.push('last_polled_at = @last_polled_at');
            params.last_polled_at = data.last_polled_at;
        }

        if (sets.length === 0) {
            log.warn('update() called with no fields to update', { id });
            return;
        }

        this.db
            .prepare(`UPDATE repositories SET ${sets.join(', ')} WHERE id = @id`)
            .run(params);

        log.debug('Repository updated', { id, fields: Object.keys(data) });
    }

    /**
     * Delete a repository by UUID.
     * Does NOT cascade-delete reviews (by design -- past reviews are retained).
     */
    delete(id: string): void {
        this.db.prepare('DELETE FROM repositories WHERE id = ?').run(id);
        log.debug('Repository deleted', { id });
    }
}
