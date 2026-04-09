import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getSchemaSQL } from './schema.js';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('database');

let db: Database.Database | null = null;

/**
 * Initialize the SQLite database.
 *
 * 1. Ensures the parent directory exists.
 * 2. Opens (or creates) a better-sqlite3 Database at `dbPath`.
 * 3. Enables WAL journal mode for concurrent read access.
 * 4. Runs the full schema DDL (all CREATE IF NOT EXISTS statements).
 * 5. Returns the Database instance and stores it as the singleton.
 */
export function initializeDatabase(dbPath: string): Database.Database {
    if (db) {
        log.warn('Database already initialized; returning existing instance');
        return db;
    }

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log.info('Created data directory', { path: dir });
    }

    db = new Database(dbPath);

    // WAL mode allows concurrent readers while a single writer holds the lock.
    db.pragma('journal_mode = WAL');
    // Enforce foreign-key constraints (off by default in SQLite).
    db.pragma('foreign_keys = ON');

    db.exec(getSchemaSQL());

    // ── Migrations for existing databases ────────────────────────
    // ALTER TABLE is not idempotent in SQLite, so wrap in try/catch.
    const migrations = [
        'ALTER TABLE reviews ADD COLUMN pr_state TEXT CHECK(pr_state IN (\'open\', \'closed\', \'merged\'))',
        'ALTER TABLE reviews ADD COLUMN pr_url TEXT',
    ];
    for (const sql of migrations) {
        try { db.exec(sql); } catch { /* column already exists */ }
    }

    log.info('Database initialized', { path: dbPath });

    return db;
}

/**
 * Return the singleton Database instance.
 * Throws if `initializeDatabase` has not been called yet.
 */
export function getDatabase(): Database.Database {
    if (!db) {
        throw new Error(
            'Database not initialized. Call initializeDatabase() before getDatabase().'
        );
    }
    return db;
}

/**
 * Close the database connection and clear the singleton.
 * Safe to call even if the database was never initialized.
 */
export function closeDatabase(): void {
    if (db) {
        db.close();
        db = null;
        log.info('Database connection closed');
    }
}
