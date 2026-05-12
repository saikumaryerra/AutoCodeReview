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
export interface ProviderResolveOpts {
    /** Per-repo Azure DevOps org URL. Falls back to env when omitted. */
    orgUrl?: string;
    /** Per-repo Azure DevOps PAT. Falls back to env when omitted. */
    token?: string;
}

export class ProviderFactory {
    private githubProvider: GitHubProvider | null = null;
    // Azure DevOps providers are cached per (orgUrl, token) pair so that
    // repos belonging to different orgs each get their own initialised
    // client.
    private azureDevOpsProviders = new Map<string, AzureDevOpsProvider>();

    constructor(private config: AppConfig) {}

    /**
     * Returns the appropriate GitProvider for the given provider name.
     * For Azure DevOps, opts.orgUrl / opts.token override env defaults so
     * different repos can target different orgs.
     */
    async getProvider(
        providerName: Provider,
        opts: ProviderResolveOpts = {},
    ): Promise<GitProvider> {
        switch (providerName) {
            case 'github':
                return this.getGitHubProvider();
            case 'azure_devops':
                return await this.getAzureDevOpsProvider(opts);
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

    private async getAzureDevOpsProvider(
        opts: ProviderResolveOpts,
    ): Promise<AzureDevOpsProvider> {
        const orgUrl = opts.orgUrl ?? this.config.azureDevOps.orgUrl;
        const token = opts.token ?? this.config.azureDevOps.token;

        if (!orgUrl || !token) {
            throw new Error(
                'Azure DevOps provider requested but no orgUrl/token available. ' +
                'Provide them per-repo or via AZURE_DEVOPS_ORG_URL / AZURE_DEVOPS_TOKEN env vars.',
            );
        }

        const cacheKey = `${orgUrl}|${token}`;
        const cached = this.azureDevOpsProviders.get(cacheKey);
        if (cached) {
            return cached;
        }

        const provider = new AzureDevOpsProvider(orgUrl, token);
        await provider.initialize();
        this.azureDevOpsProviders.set(cacheKey, provider);
        log.info('Azure DevOps provider created', { orgUrl });
        return provider;
    }
}
