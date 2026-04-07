import { describe, it, expect } from 'vitest';
import { buildReviewPrompt } from './prompt.js';

describe('buildReviewPrompt', () => {
    it('includes PR metadata in the prompt', () => {
        const prompt = buildReviewPrompt({
            repoFullName: 'myorg/backend-api',
            prNumber: 42,
            prTitle: 'Add authentication',
            prAuthor: 'alice',
            branchName: 'feature/auth',
            commitSha: 'abc1234def5678',
            commitMessage: 'implement JWT middleware',
            diff: '--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,3 +1,5 @@\n+import jwt from "jsonwebtoken";\n',
            changedFiles: ['src/auth.ts', 'src/middleware.ts'],
        });

        expect(prompt).toContain('PR #42');
        expect(prompt).toContain('Add authentication');
        expect(prompt).toContain('alice');
        expect(prompt).toContain('myorg/backend-api');
        expect(prompt).toContain('feature/auth');
        expect(prompt).toContain('abc1234def5678');
        expect(prompt).toContain('src/auth.ts');
        expect(prompt).toContain('src/middleware.ts');
        expect(prompt).toContain('import jwt');
    });

    it('requests JSON response format', () => {
        const prompt = buildReviewPrompt({
            repoFullName: 'org/repo',
            prNumber: 1,
            prTitle: 'Test',
            prAuthor: 'bob',
            branchName: 'main',
            commitSha: 'abc1234',
            commitMessage: 'test',
            diff: '',
            changedFiles: [],
        });

        expect(prompt).toContain('JSON');
        expect(prompt).toContain('summary');
        expect(prompt).toContain('severity');
        expect(prompt).toContain('findings');
    });
});
