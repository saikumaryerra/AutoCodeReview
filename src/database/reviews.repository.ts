import type Database from 'better-sqlite3';
import type { Review, ReviewStatus, Severity, Provider } from '../shared/types.js';
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
    page?: number;
    limit?: number;
    sort?: 'created_at' | 'severity' | 'pr_number';
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
                summary, severity, findings, raw_output, files_reviewed, stats,
                review_duration_ms, claude_model, status, error_message, created_at
            ) VALUES (
                @id, @repo_full_name, @provider, @pr_number, @pr_title, @pr_author,
                @commit_sha, @commit_message, @branch_name, @target_branch,
                @summary, @severity, @findings, @raw_output, @files_reviewed, @stats,
                @review_duration_ms, @claude_model, @status, @error_message, @created_at
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
                commit_sha, commit_message, branch_name,
                summary, severity, files_reviewed, stats,
                review_duration_ms, claude_model, status, error_message, created_at,
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
