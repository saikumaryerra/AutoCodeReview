import { describe, it, expect } from 'vitest';
import { ReviewQueue } from './queue.js';

function makeJob(id: string) {
    return {
        id,
        repoFullName: 'owner/repo',
        provider: 'github' as const,
        prNumber: 1,
        prTitle: 'Test PR',
        prAuthor: 'alice',
        commitSha: 'abc1234567890',
        commitMessage: 'test commit',
        branchName: 'feature/test',
        enqueuedAt: new Date(),
    };
}

describe('ReviewQueue', () => {
    it('starts empty', () => {
        const queue = new ReviewQueue();
        expect(queue.isEmpty()).toBe(true);
        expect(queue.size()).toBe(0);
        expect(queue.dequeue()).toBeNull();
    });

    it('enqueues and dequeues in FIFO order', () => {
        const queue = new ReviewQueue();
        const job1 = makeJob('1');
        const job2 = makeJob('2');
        const job3 = makeJob('3');

        queue.enqueue(job1);
        queue.enqueue(job2);
        queue.enqueue(job3);

        expect(queue.size()).toBe(3);
        expect(queue.dequeue()?.id).toBe('1');
        expect(queue.dequeue()?.id).toBe('2');
        expect(queue.dequeue()?.id).toBe('3');
        expect(queue.dequeue()).toBeNull();
    });

    it('peek returns first item without removing', () => {
        const queue = new ReviewQueue();
        const job = makeJob('1');
        queue.enqueue(job);

        expect(queue.peek()?.id).toBe('1');
        expect(queue.size()).toBe(1);
    });

    it('getAll returns a copy', () => {
        const queue = new ReviewQueue();
        queue.enqueue(makeJob('1'));
        queue.enqueue(makeJob('2'));

        const all = queue.getAll();
        expect(all).toHaveLength(2);
        // Mutating returned array should not affect queue
        all.pop();
        expect(queue.size()).toBe(2);
    });
});
