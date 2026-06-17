import type Database from 'better-sqlite3';
import type { Review, ReviewStatus, Severity, Provider, PrState, PRListItem } from '../shared/types.js';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('reviews-repo');

// ── Helper types ────────────────────────────────────────────────

/** The raw row shape coming out of SQLite (JSON columns are TEXT). */
interface ReviewRow {
    id: string;
    repo_full_name: string;
    provider: string;
    pr_number: number;
    pr_title: string;
    pr_author: string;
    commit_sha: string;
    commit_message: string | null;
    branch_name: string;
    pr_state: string | null;
    pr_url: string | null;
    summary: string;
    severity: string;
    findings: string;
    raw_output: string;
    files_reviewed: string;
    stats: string;
    review_duration_ms: number | null;
    claude_model: string | null;
    status: string;
    error_message: string | null;
    created_at: string;
    retry_count: number;
    next_retry_at: string | null;
}

/** List-level row includes findings_count instead of full findings. */
interface ReviewListRow extends Omit<ReviewRow, 'findings' | 'raw_output'> {
    findings_count: number;
}

/** Parsed review returned to callers (domain type). */
export type ParsedReview = Review;

/** Parsed list item (no raw_output, findings replaced by count). */
export interface ReviewListItem extends Omit<Review, 'findings' | 'raw_output'> {
    findings_count: number;
}

export interface ReviewListFilters {
    repo?: string;
    provider?: Provider;
    pr?: number;
    commit?: string;
    severity?: Severity;
    status?: ReviewStatus;
    pr_state?: PrState;
    page?: number;
    limit?: number;
    sort?: 'created_at' | 'severity' | 'pr_number';
    order?: 'asc' | 'desc';
}

export interface PRListFilters {
    repo?: string;
    provider?: Provider;
    severity?: Severity;
    pr_state?: PrState;
    page?: number;
    limit?: number;
    sort?: 'latest_review_at' | 'pr_number' | 'severity';
    order?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
    };
}

// ── Parsing helpers ─────────────────────────────────────────────

function parseReviewRow(row: ReviewRow): ParsedReview {
    return {
        ...row,
        provider: row.provider as Provider,
        severity: row.severity as Severity,
        status: row.status as ReviewStatus,
        pr_state: row.pr_state as PrState | null,
        findings: JSON.parse(row.findings),
        files_reviewed: JSON.parse(row.files_reviewed),
        stats: JSON.parse(row.stats),
    };
}

function parseListRow(row: ReviewListRow): ReviewListItem {
    return {
        ...row,
        provider: row.provider as Provider,
        severity: row.severity as Severity,
        status: row.status as ReviewStatus,
        pr_state: row.pr_state as PrState | null,
        files_reviewed: JSON.parse(row.files_reviewed),
        stats: JSON.parse(row.stats),
        findings_count: row.findings_count,
    };
}

// ── Allowed sort columns (whitelist to prevent SQL injection) ────
const SORT_COLUMNS: Record<string, string> = {
    created_at: 'created_at',
    severity: 'severity',
    pr_number: 'pr_number',
};

// ── Repository class ────────────────────────────────────────────

export class ReviewsRepository {
    constructor(private db: Database.Database) {}

    /**
     * Insert a new review. JSON fields are serialized before storage.
     */
    insert(review: Review): void {
        const stmt = this.db.prepare(`
            INSERT INTO reviews (
                id, repo_full_name, provider, pr_number, pr_title, pr_author,
                commit_sha, commit_message, branch_name, target_branch,
                pr_state, pr_url,
                summary, severity, findings, raw_output, files_reviewed, stats,
                review_duration_ms, claude_model, status, error_message, created_at,
                retry_count, next_retry_at
            ) VALUES (
                @id, @repo_full_name, @provider, @pr_number, @pr_title, @pr_author,
                @commit_sha, @commit_message, @branch_name, @target_branch,
                @pr_state, @pr_url,
                @summary, @severity, @findings, @raw_output, @files_reviewed, @stats,
                @review_duration_ms, @claude_model, @status, @error_message, @created_at,
                @retry_count, @next_retry_at
            )
        `);

        stmt.run({
            id: review.id,
            repo_full_name: review.repo_full_name,
            provider: review.provider,
            pr_number: review.pr_number,
            pr_title: review.pr_title,
            pr_author: review.pr_author,
            commit_sha: review.commit_sha,
            commit_message: review.commit_message,
            branch_name: review.branch_name,
            target_branch: review.target_branch ?? 'main',
            pr_state: review.pr_state ?? null,
            pr_url: review.pr_url ?? null,
            summary: review.summary,
            severity: review.severity,
            findings: JSON.stringify(review.findings),
            raw_output: review.raw_output,
            files_reviewed: JSON.stringify(review.files_reviewed),
            stats: JSON.stringify(review.stats),
            review_duration_ms: review.review_duration_ms,
            claude_model: review.claude_model,
            status: review.status,
            error_message: review.error_message,
            created_at: review.created_at,
            retry_count: review.retry_count ?? 0,
            next_retry_at: review.next_retry_at ?? null,
        });

        log.debug('Review inserted', { id: review.id, repo: review.repo_full_name, pr: review.pr_number });
    }

    /**
     * Update only the status (and optionally error_message) of a review.
     */
    updateStatus(id: string, status: ReviewStatus, errorMessage?: string): void {
        const stmt = this.db.prepare(`
            UPDATE reviews
            SET status = @status, error_message = @error_message
            WHERE id = @id
        `);

        stmt.run({
            id,
            status,
            error_message: errorMessage ?? null,
        });

        log.debug('Review status updated', { id, status });
    }

    /**
     * Update the parsed review fields after Claude CLI completes.
     */
    updateReview(
        id: string,
        data: {
            summary: string;
            severity: Severity;
            findings: Review['findings'];
            raw_output: string;
            files_reviewed: string[];
            stats: Review['stats'];
            review_duration_ms: number | null;
            claude_model: string | null;
            status: ReviewStatus;
        }
    ): void {
        const stmt = this.db.prepare(`
            UPDATE reviews
            SET summary = @summary,
                severity = @severity,
                findings = @findings,
                raw_output = @raw_output,
                files_reviewed = @files_reviewed,
                stats = @stats,
                review_duration_ms = @review_duration_ms,
                claude_model = @claude_model,
                status = @status
            WHERE id = @id
        `);

        stmt.run({
            id,
            summary: data.summary,
            severity: data.severity,
            findings: JSON.stringify(data.findings),
            raw_output: data.raw_output,
            files_reviewed: JSON.stringify(data.files_reviewed),
            stats: JSON.stringify(data.stats),
            review_duration_ms: data.review_duration_ms,
            claude_model: data.claude_model,
            status: data.status,
        });

        log.debug('Review updated', { id, status: data.status });
    }

    /**
     * Fetch a single review by UUID. Returns null if not found.
     */
    getById(id: string): ParsedReview | null {
        const row = this.db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as ReviewRow | undefined;
        return row ? parseReviewRow(row) : null;
    }

    /**
     * Fetch a review by commit SHA with prefix matching (minimum 7 characters).
     * Returns the first match (there should only be one per commit).
     */
    getByCommit(sha: string): ParsedReview | null {
        if (sha.length < 7) {
            log.warn('Commit SHA too short for prefix match', { sha, length: sha.length });
            return null;
        }

        const row = this.db
            .prepare('SELECT * FROM reviews WHERE commit_sha LIKE ? LIMIT 1')
            .get(`${sha}%`) as ReviewRow | undefined;

        return row ? parseReviewRow(row) : null;
    }

    /**
     * Fetch all reviews for a given PR, ordered by created_at ascending.
     */
    getByPR(repoFullName: string, prNumber: number): ParsedReview[] {
        const rows = this.db
            .prepare(
                'SELECT * FROM reviews WHERE repo_full_name = ? AND pr_number = ? ORDER BY created_at ASC'
            )
            .all(repoFullName, prNumber) as ReviewRow[];

        return rows.map(parseReviewRow);
    }

    /**
     * Paginated listing with optional filters.
     *
     * Returns findings_count (length of the JSON array) instead of the full
     * findings blob to keep list responses lightweight.
     */
    list(filters: ReviewListFilters = {}): PaginatedResult<ReviewListItem> {
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
        const sortCol = SORT_COLUMNS[filters.sort ?? 'created_at'] ?? 'created_at';
        const order = filters.order === 'asc' ? 'ASC' : 'DESC';

        const conditions: string[] = [];
        const params: Record<string, unknown> = {};

        if (filters.repo) {
            conditions.push('repo_full_name = @repo');
            params.repo = filters.repo;
        }
        if (filters.provider) {
            conditions.push('provider = @provider');
            params.provider = filters.provider;
        }
        if (filters.pr !== undefined) {
            conditions.push('pr_number = @pr');
            params.pr = filters.pr;
        }
        if (filters.commit) {
            if (filters.commit.length >= 7) {
                conditions.push('commit_sha LIKE @commit');
                params.commit = `${filters.commit}%`;
            }
        }
        if (filters.severity) {
            conditions.push('severity = @severity');
            params.severity = filters.severity;
        }
        if (filters.status) {
            conditions.push('status = @status');
            params.status = filters.status;
        }
        if (filters.pr_state) {
            conditions.push('pr_state = @pr_state');
            params.pr_state = filters.pr_state;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Count total matching rows.
        const countSQL = `SELECT COUNT(*) AS total FROM reviews ${whereClause}`;
        const { total } = this.db.prepare(countSQL).get(params) as { total: number };

        const total_pages = Math.max(1, Math.ceil(total / limit));
        const offset = (page - 1) * limit;

        // Select list columns. Use json_array_length for findings_count.
        const dataSQL = `
            SELECT
                id, repo_full_name, provider, pr_number, pr_title, pr_author,
                commit_sha, commit_message, branch_name, pr_state, pr_url,
                summary, severity, files_reviewed, stats,
                review_duration_ms, claude_model, status, error_message, created_at,
                retry_count, next_retry_at,
                json_array_length(findings) AS findings_count
            FROM reviews
            ${whereClause}
            ORDER BY ${sortCol} ${order}
            LIMIT @limit OFFSET @offset
        `;

        const rows = this.db
            .prepare(dataSQL)
            .all({ ...params, limit, offset }) as ReviewListRow[];

        return {
            data: rows.map(parseListRow),
            pagination: { page, limit, total, total_pages },
        };
    }

    /**
     * Paginated listing grouped by PR. One row per (repo_full_name, pr_number),
     * carrying the latest review's metadata plus the total review count.
     *
     * Filters `severity` / `pr_state` apply to the **latest** review of each PR
     * (the one surfaced on the card), matching user expectation that the card's
     * visible severity is what gets filtered.
     */
    listGroupedByPR(filters: PRListFilters = {}): PaginatedResult<PRListItem> {
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
        const sortKey = filters.sort ?? 'latest_review_at';
        const order = filters.order === 'asc' ? 'ASC' : 'DESC';

        // Map public sort keys to SQL expressions (whitelist guards injection).
        const sortExpr: Record<string, string> = {
            latest_review_at: 'latest_review_at',
            pr_number: 'pr_number',
            severity: `CASE latest.severity
                WHEN 'critical' THEN 0
                WHEN 'warning' THEN 1
                WHEN 'info' THEN 2
                WHEN 'clean' THEN 3
                ELSE 4 END`,
        };
        const orderByCol = sortExpr[sortKey] ?? sortExpr.latest_review_at;

        const preConditions: string[] = [];
        const postConditions: string[] = [];
        const params: Record<string, unknown> = {};

        // Filters that can be applied before grouping (narrow row scan).
        if (filters.repo) {
            preConditions.push('repo_full_name = @repo');
            params.repo = filters.repo;
        }
        if (filters.provider) {
            preConditions.push('provider = @provider');
            params.provider = filters.provider;
        }

        // Filters on the latest review's fields (post-join).
        if (filters.severity) {
            postConditions.push('latest.severity = @severity');
            params.severity = filters.severity;
        }
        if (filters.pr_state) {
            postConditions.push('latest.pr_state = @pr_state');
            params.pr_state = filters.pr_state;
        }

        const preWhere = preConditions.length > 0 ? `WHERE ${preConditions.join(' AND ')}` : '';
        const postWhere = postConditions.length > 0 ? `WHERE ${postConditions.join(' AND ')}` : '';

        // CTE: pick the latest review per PR. Tie-break on id for determinism
        // when multiple reviews share a created_at (unlikely but cheap insurance).
        const baseCTE = `
            WITH agg AS (
                SELECT
                    repo_full_name,
                    pr_number,
                    MAX(created_at) AS latest_review_at,
                    COUNT(*) AS review_count
                FROM reviews
                ${preWhere}
                GROUP BY repo_full_name, pr_number
            ),
            latest AS (
                SELECT r.*, agg.latest_review_at, agg.review_count
                FROM agg
                JOIN reviews r
                  ON r.repo_full_name = agg.repo_full_name
                 AND r.pr_number = agg.pr_number
                 AND r.created_at = agg.latest_review_at
                -- Tie-break: if two reviews share created_at, prefer higher id
                -- lexicographically (deterministic, cheap).
                WHERE r.id = (
                    SELECT r2.id FROM reviews r2
                    WHERE r2.repo_full_name = agg.repo_full_name
                      AND r2.pr_number = agg.pr_number
                      AND r2.created_at = agg.latest_review_at
                    ORDER BY r2.id DESC LIMIT 1
                )
            )
        `;

        const countSQL = `${baseCTE} SELECT COUNT(*) AS total FROM latest ${postWhere}`;
        const { total } = this.db.prepare(countSQL).get(params) as { total: number };

        const total_pages = Math.max(1, Math.ceil(total / limit));
        const offset = (page - 1) * limit;

        const dataSQL = `
            ${baseCTE}
            SELECT
                repo_full_name,
                provider,
                pr_number,
                pr_title,
                pr_author,
                branch_name,
                pr_state,
                pr_url,
                id AS latest_review_id,
                commit_sha AS latest_commit_sha,
                severity AS latest_severity,
                status AS latest_status,
                json_array_length(findings) AS latest_findings_count,
                review_duration_ms AS latest_review_duration_ms,
                latest_review_at,
                review_count
            FROM latest
            ${postWhere}
            ORDER BY ${orderByCol} ${order}
            LIMIT @limit OFFSET @offset
        `;

        interface PRGroupRow {
            repo_full_name: string;
            provider: string;
            pr_number: number;
            pr_title: string;
            pr_author: string;
            branch_name: string;
            pr_state: string | null;
            pr_url: string | null;
            latest_review_id: string;
            latest_commit_sha: string;
            latest_severity: string;
            latest_status: string;
            latest_findings_count: number;
            latest_review_duration_ms: number | null;
            latest_review_at: string;
            review_count: number;
        }

        const rows = this.db
            .prepare(dataSQL)
            .all({ ...params, limit, offset }) as PRGroupRow[];

        const data: PRListItem[] = rows.map((r) => ({
            repo_full_name: r.repo_full_name,
            provider: r.provider as Provider,
            pr_number: r.pr_number,
            pr_title: r.pr_title,
            pr_author: r.pr_author,
            branch_name: r.branch_name,
            pr_state: r.pr_state as PrState | null,
            pr_url: r.pr_url,
            latest_review_id: r.latest_review_id,
            latest_commit_sha: r.latest_commit_sha,
            latest_severity: r.latest_severity as Severity,
            latest_status: r.latest_status as ReviewStatus,
            latest_findings_count: r.latest_findings_count,
            latest_review_duration_ms: r.latest_review_duration_ms,
            latest_review_at: r.latest_review_at,
            review_count: r.review_count,
        }));

        return {
            data,
            pagination: { page, limit, total, total_pages },
        };
    }

    /**
     * Count reviews matching a given status.
     */
    getCountByStatus(status: ReviewStatus): number {
        const row = this.db
            .prepare('SELECT COUNT(*) AS count FROM reviews WHERE status = ?')
            .get(status) as { count: number };
        return row.count;
    }

    /**
     * Count reviews created today (UTC).
     */
    getTodayCount(): number {
        const row = this.db
            .prepare("SELECT COUNT(*) AS count FROM reviews WHERE date(created_at) = date('now')")
            .get() as { count: number };
        return row.count;
    }

    /**
     * Count all completed reviews.
     */
    getTotalCompleted(): number {
        return this.getCountByStatus('completed');
    }
}
