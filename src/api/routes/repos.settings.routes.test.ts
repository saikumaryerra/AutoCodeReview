import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { getSchemaSQL } from '../../database/schema.js';
import { SettingsRepository } from '../../database/settings.repository.js';
import { RepoSettingsRepository } from '../../database/repo-settings.repository.js';
import { ConfigService } from '../../config/config.service.js';
import { createReposRouter } from './repos.routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import type { AppConfig } from '../../config/config.js';

const ENV_CONFIG = {
    review: { maxFilesChanged: 50 },
    github: { token: 'ghp_TESTSECRET' },
} as unknown as AppConfig;

function makeApp() {
    const db = new Database(':memory:');
    db.exec(getSchemaSQL());
    db.prepare(
        `INSERT INTO repositories (id, full_name, provider, default_branch)
         VALUES ('repo-a', 'acme/a', 'github', 'main')`
    ).run();
    const configService = new ConfigService(
        new SettingsRepository(db), ENV_CONFIG, new RepoSettingsRepository(db),
    );
    const app = express();
    app.use(express.json());
    app.use('/api/v1/repos', createReposRouter({
        db,
        providerFactory: { getProvider: async () => ({}) } as any,
        repoManager: {} as any,
        standardsGenerator: {} as any,
        configService,
    }));
    app.use(errorHandler);
    return app;
}

describe('repos settings routes', () => {
    let app: express.Express;
    beforeEach(() => { app = makeApp(); });

    it('GET lists the 8 overridable keys, all inherited by default', async () => {
        const res = await request(app).get('/api/v1/repos/repo-a/settings');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(8);
        expect(res.body.data.every((s: any) => s.is_overridden === false)).toBe(true);
    });

    it('PUT sets an override', async () => {
        const res = await request(app)
            .put('/api/v1/repos/repo-a/settings/review.maxFilesChanged')
            .send({ value: 200 });
        expect(res.status).toBe(200);
        expect(res.body.data.effective_value).toBe(200);
        const list = await request(app).get('/api/v1/repos/repo-a/settings');
        const mf = list.body.data.find((s: any) => s.key === 'review.maxFilesChanged');
        expect(mf.is_overridden).toBe(true);
        expect(mf.repo_value).toBe(200);
    });

    it('DELETE clears one override', async () => {
        await request(app).put('/api/v1/repos/repo-a/settings/review.maxFilesChanged').send({ value: 200 });
        const res = await request(app).delete('/api/v1/repos/repo-a/settings/review.maxFilesChanged');
        expect(res.status).toBe(200);
        expect(res.body.data.is_overridden).toBe(false);
        expect(res.body.data.effective_value).toBe(50);
    });

    it('DELETE /settings clears all overrides', async () => {
        await request(app).put('/api/v1/repos/repo-a/settings/review.maxFilesChanged').send({ value: 200 });
        await request(app).put('/api/v1/repos/repo-a/settings/review.skipDrafts').send({ value: false });
        const res = await request(app).delete('/api/v1/repos/repo-a/settings');
        expect(res.status).toBe(200);
        const list = await request(app).get('/api/v1/repos/repo-a/settings');
        expect(list.body.data.every((s: any) => s.is_overridden === false)).toBe(true);
    });

    it('404 for unknown repo', async () => {
        const res = await request(app).get('/api/v1/repos/nope/settings');
        expect(res.status).toBe(404);
    });

    it('404 for a non-overridable key', async () => {
        const res = await request(app)
            .put('/api/v1/repos/repo-a/settings/claude.model')
            .send({ value: 'opus' });
        expect(res.status).toBe(404);
    });

    it('400 for an out-of-bounds value', async () => {
        const res = await request(app)
            .put('/api/v1/repos/repo-a/settings/review.maxFilesChanged')
            .send({ value: 99999 });
        expect(res.status).toBe(400);
    });

    it('DELETE refuses a non-overridable key rather than returning its value', async () => {
        const res = await request(app).delete('/api/v1/repos/repo-a/settings/github.token');
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain('ghp_');
    });

    it('DELETE still clears a real override', async () => {
        await request(app)
            .put('/api/v1/repos/repo-a/settings/review.maxFilesChanged')
            .send({ value: 200 });
        const res = await request(app)
            .delete('/api/v1/repos/repo-a/settings/review.maxFilesChanged');
        expect(res.status).toBe(200);
        expect(res.body.data.is_overridden).toBe(false);
        expect(res.body.data.effective_value).toBe(50);
    });
});
