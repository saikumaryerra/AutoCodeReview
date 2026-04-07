import { describe, it, expect } from 'vitest';
import { parseClaudeOutput } from './parser.js';

describe('parseClaudeOutput', () => {
    it('parses valid Claude CLI JSON output', () => {
        const output = JSON.stringify({
            result: JSON.stringify({
                summary: 'Clean code with good practices.',
                severity: 'clean',
                findings: [],
            }),
            model: 'claude-sonnet-4-20250514',
        });

        const result = parseClaudeOutput(output);
        expect(result.summary).toBe('Clean code with good practices.');
        expect(result.severity).toBe('clean');
        expect(result.findings).toEqual([]);
        expect(result.model).toBe('claude-sonnet-4-20250514');
    });

    it('parses output with findings', () => {
        const review = {
            summary: 'Found a potential SQL injection.',
            severity: 'critical',
            findings: [
                {
                    type: 'security',
                    severity: 'critical',
                    file: 'src/db.ts',
                    line_start: 42,
                    line_end: 45,
                    title: 'SQL Injection Risk',
                    description: 'User input is concatenated directly into SQL query.',
                    suggestion: 'Use parameterized queries.',
                    code_snippet: 'db.exec(`SELECT * FROM users WHERE id = ${id}`)',
                },
            ],
        };

        const output = JSON.stringify({
            result: JSON.stringify(review),
            model: 'claude-sonnet-4-20250514',
        });

        const result = parseClaudeOutput(output);
        expect(result.severity).toBe('critical');
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].type).toBe('security');
        expect(result.findings[0].title).toBe('SQL Injection Risk');
    });

    it('handles markdown-wrapped JSON in result', () => {
        const review = {
            summary: 'All good.',
            severity: 'clean',
            findings: [],
        };

        const output = JSON.stringify({
            result: '```json\n' + JSON.stringify(review) + '\n```',
        });

        const result = parseClaudeOutput(output);
        expect(result.summary).toBe('All good.');
        expect(result.severity).toBe('clean');
    });

    it('returns fallback for completely invalid output', () => {
        const result = parseClaudeOutput('this is not json at all');
        expect(result.summary).toContain('Failed to parse');
        expect(result.severity).toBe('warning');
        expect(result.findings).toEqual([]);
    });

    it('returns fallback for empty string', () => {
        const result = parseClaudeOutput('');
        expect(result.severity).toBe('warning');
        expect(result.findings).toEqual([]);
    });
});
