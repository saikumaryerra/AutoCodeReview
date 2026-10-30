import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderAuthError } from '../shared/errors.js';

const getGitApi = vi.fn();

vi.mock('azure-devops-node-api', () => ({
    getPersonalAccessTokenHandler: vi.fn(() => ({})),
    WebApi: vi.fn(() => ({ getGitApi })),
}));

const { AzureDevOpsProvider } = await import('./azuredevops.provider.js');

function httpError(statusCode: number): Error {
    return Object.assign(new Error(`Failed request: (${statusCode})`), { statusCode });
}

describe('AzureDevOpsProvider.initialize', () => {
    beforeEach(() => {
        getGitApi.mockReset();
    });

    it.each([401, 403])('maps HTTP %i to ProviderAuthError (502)', async (status) => {
        getGitApi.mockRejectedValue(httpError(status));
        const provider = new AzureDevOpsProvider('https://dev.azure.com/acme', 'pat');

        const err = await provider.initialize().catch((e: Error) => e);

        expect(err).toBeInstanceOf(ProviderAuthError);
        expect(err).toMatchObject({ statusCode: 502, code: 'PROVIDER_AUTH_FAILED' });
        expect((err as Error).message).toContain('https://dev.azure.com/acme');
    });

    it('rethrows non-auth failures unchanged', async () => {
        const original = httpError(500);
        getGitApi.mockRejectedValue(original);
        const provider = new AzureDevOpsProvider('https://dev.azure.com/acme', 'pat');

        await expect(provider.initialize()).rejects.toBe(original);
    });
});
