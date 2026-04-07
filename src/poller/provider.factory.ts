import type { AppConfig } from '../config/config.js';
import type { GitProvider, Provider } from '../shared/types.js';
import { GitHubProvider } from './github.provider.js';
import { AzureDevOpsProvider } from './azuredevops.provider.js';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('provider-factory');

/**
 * Creates and caches GitProvider instances based on configuration.
 *
 * Each provider is instantiated once and reused for all subsequent calls.
 * For Azure DevOps, the async initialize() step is handled transparently.
 */
export class ProviderFactory {
    private githubProvider: GitHubProvider | null = null;
    private azureDevOpsProvider: AzureDevOpsProvider | null = null;

    constructor(private config: AppConfig) {}

    /**
     * Returns the appropriate GitProvider for the given provider name.
     * Creates and caches the instance on first call.
     * Throws if the requested provider is not configured.
     */
    async getProvider(providerName: Provider): Promise<GitProvider> {
        switch (providerName) {
            case 'github':
                return this.getGitHubProvider();
            case 'azure_devops':
                return await this.getAzureDevOpsProvider();
            default:
                throw new Error(`Unknown provider: ${providerName}`);
        }
    }

    /**
     * Returns all configured repositories across all providers.
     * Used at startup to seed the repositories table and during polling
     * to determine which repos to check.
     */
    getAllConfiguredRepos(): Array<{
        fullName: string;
        provider: Provider;
    }> {
        const repos: Array<{ fullName: string; provider: Provider }> = [];

        for (const repoName of this.config.github.repos) {
            repos.push({ fullName: repoName, provider: 'github' });
        }

        for (const repoName of this.config.azureDevOps.repos) {
            repos.push({ fullName: repoName, provider: 'azure_devops' });
        }

        return repos;
    }

    // ── Private helpers ──────────────────────────────────────────

    private getGitHubProvider(): GitHubProvider {
        if (this.githubProvider) {
            return this.githubProvider;
        }

        const token = this.config.github.token;
        if (!token) {
            throw new Error(
                'GitHub provider requested but GITHUB_TOKEN is not configured.'
            );
        }

        this.githubProvider = new GitHubProvider(token);
        log.info('GitHub provider created');
        return this.githubProvider;
    }

    private async getAzureDevOpsProvider(): Promise<AzureDevOpsProvider> {
        if (this.azureDevOpsProvider) {
            return this.azureDevOpsProvider;
        }

        const token = this.config.azureDevOps.token;
        const orgUrl = this.config.azureDevOps.orgUrl;
        if (!token || !orgUrl) {
            throw new Error(
                'Azure DevOps provider requested but AZURE_DEVOPS_TOKEN or AZURE_DEVOPS_ORG_URL is not configured.'
            );
        }

        const provider = new AzureDevOpsProvider(orgUrl, token);
        await provider.initialize();
        this.azureDevOpsProvider = provider;
        log.info('Azure DevOps provider created', { orgUrl });
        return provider;
    }
}
