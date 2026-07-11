import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execCommand } from '../utils/shell.js';
import { ClaudeCliExecutor } from './claude-cli.executor.js';

vi.mock('../utils/shell.js', () => ({
    execCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
}));

const mockExec = vi.mocked(execCommand);

describe('ClaudeCliExecutor — runtime timeout changes', () => {
    beforeEach(() => {
        mockExec.mockClear();
    });

    it('uses the constructor timeout for the first review', async () => {
        const executor = new ClaudeCliExecutor('claude', 300, undefined);

        await executor.executeReview('/tmp/repo', 'prompt');

        expect(mockExec).toHaveBeenCalledTimes(1);
        expect(mockExec.mock.calls[0][2]).toMatchObject({ timeoutMs: 300_000 });
    });

    it('applies a new timeout to subsequent reviews without reconstruction', async () => {
        const executor = new ClaudeCliExecutor('claude', 300, undefined);

        executor.setTimeoutSeconds(900);
        await executor.executeReview('/tmp/repo', 'prompt');

        expect(mockExec.mock.calls[0][2]).toMatchObject({ timeoutMs: 900_000 });
    });
});
