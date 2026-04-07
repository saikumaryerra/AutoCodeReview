import * as azdev from 'azure-devops-node-api';
import type { IGitApi } from 'azure-devops-node-api/GitApi.js';
import {
    PullRequestStatus,
    VersionControlChangeType,
} from 'azure-devops-node-api/interfaces/GitInterfaces.js';
import type {
    GitProvider,
    ProviderPullRequest,
    ProviderCommit,
    ProviderFile,
} from '../shared/types.js';
import { createModuleLogger } from '../shared/logger.js';

const log = createModuleLogger('azuredevops-provider');

/**
 * Azure DevOps implementation of the GitProvider interface.
 *
 * Uses azure-devops-node-api to interact with Azure DevOps Git APIs.
 * Must call initialize() before any other method.
 *
 * Key concept mapping:
 * - Azure DevOps: Organization -> Project -> Repository
 * - Repo format in config: "Project/RepoName"
 * - PR states: active -> open, completed -> merged, abandoned -> closed
 */
export class AzureDevOpsProvider implements GitProvider {
    readonly providerName = 'azure_devops' as const;
    private gitApi: IGitApi | null = null;

    constructor(
        private orgUrl: string,
        private token: string
    ) {}

    /**
     * Creates the WebApi connection and obtains the IGitApi handle.
     * Must be called once before any other method. Called by ProviderFactory.
     */
    async initialize(): Promise<void> {
        const authHandler = azdev.getPersonalAccessTokenHandler(this.token);
        const connection = new azdev.WebApi(this.orgUrl, authHandler);
        this.gitApi = await connection.getGitApi();
        log.info('Azure DevOps provider initialized', { orgUrl: this.orgUrl });
    }

    async listPullRequests(
        repoFullName: string,
        state: 'open' | 'closed' | 'all'
    ): Promise<ProviderPullRequest[]> {
        const api = this.getApi();
        const { project, repo } = this.splitRepo(repoFullName);

        const results: ProviderPullRequest[] = [];

        // Determine which statuses to fetch
        const statusesToFetch: PullRequestStatus[] = [];
        switch (state) {
            case 'open':
                statusesToFetch.push(PullRequestStatus.Active);
                break;
            case 'closed':
                statusesToFetch.push(PullRequestStatus.Abandoned);
                statusesToFetch.push(PullRequestStatus.Completed);
                break;
            case 'all':
                statusesToFetch.push(PullRequestStatus.All);
                break;
        }

        for (const status of statusesToFetch) {
            const prs = await api.getPullRequests(repo, { status }, project);

            for (const pr of prs) {
                let mappedState: ProviderPullRequest['state'];
                switch (pr.status) {
                    case PullRequestStatus.Active:
                        mappedState = 'open';
                        break;
                    case PullRequestStatus.Completed:
                        mappedState = 'merged';
                        break;
                    case PullRequestStatus.Abandoned:
                        mappedState = 'closed';
                        break;
                    default:
                        mappedState = 'open';
                }

                // Strip Azure DevOps ref prefixes: "refs/heads/feature/x" -> "feature/x"
                const sourceBranch = (pr.sourceRefName ?? '').replace(
                    'refs/heads/',
                    ''
                );
                const targetBranch = (pr.targetRefName ?? '').replace(
                    'refs/heads/',
                    ''
                );

                const prUrl = `${this.orgUrl}/${project}/_git/${repo}/pullrequest/${pr.pullRequestId}`;

                results.push({
                    number: pr.pullRequestId ?? 0,
                    title: pr.title ?? '',
                    author: pr.createdBy?.uniqueName ?? pr.createdBy?.displayName ?? 'unknown',
                    sourceBranch,
                    targetBranch,
                    isDraft: pr.isDraft ?? false,
                    state: mappedState,
                    url: prUrl,
                });
            }
        }

        return results;
    }

    async listPRCommits(
        repoFullName: string,
        prNumber: number
    ): Promise<ProviderCommit[]> {
        const api = this.getApi();
        const { project, repo } = this.splitRepo(repoFullName);

        const commits = await api.getPullRequestCommits(repo, prNumber, project);

        return commits.map((c) => ({
            sha: c.commitId ?? '',
            message: (c.comment ?? '').split('\n')[0],
            author: c.author?.name ?? 'unknown',
            date: c.author?.date?.toISOString() ?? new Date().toISOString(),
        }));
    }

    /**
     * Azure DevOps does not have a direct "get unified diff" endpoint.
     * Returns an empty string. The RepoManager generates diffs locally
     * using `git diff` after checking out the repo, which provides
     * consistent diff formatting across all providers.
     */
    async getPRDiff(
        _repoFullName: string,
        _prNumber: number
    ): Promise<string> {
        return '';
    }

    async getPRFiles(
        repoFullName: string,
        prNumber: number
    ): Promise<ProviderFile[]> {
        const api = this.getApi();
        const { project, repo } = this.splitRepo(repoFullName);

        // Get the latest iteration (Azure DevOps groups PR updates into iterations)
        const iterations = await api.getPullRequestIterations(
            repo,
            prNumber,
            project
        );

        if (!iterations || iterations.length === 0) {
            log.warn('No iterations found for PR', {
                repo: repoFullName,
                pr: prNumber,
            });
            return [];
        }

        const latestIteration = iterations[iterations.length - 1];
        const iterationId = latestIteration.id;

        if (iterationId === undefined) {
            log.warn('Latest iteration has no ID', {
                repo: repoFullName,
                pr: prNumber,
            });
            return [];
        }

        const changes = await api.getPullRequestIterationChanges(
            repo,
            prNumber,
            iterationId,
            project
        );

        if (!changes?.changeEntries) {
            return [];
        }

        return changes.changeEntries
            .filter((entry) => entry.item?.path)
            .map((entry) => ({
                path: entry.item!.path!.replace(/^\//, ''),
                additions: 0, // Azure DevOps iteration changes don't provide line counts
                deletions: 0,
                status: this.mapChangeType(entry.changeType),
            }));
    }

    getCloneUrl(repoFullName: string): string {
        const { project, repo } = this.splitRepo(repoFullName);
        // Extract org name from orgUrl (e.g., "https://dev.azure.com/myorg" -> "myorg")
        const org = this.extractOrgName();
        return `https://pat:${this.token}@dev.azure.com/${org}/${project}/_git/${repo}`;
    }

    // ── Private helpers ──────────────────────────────────────────

    private getApi(): IGitApi {
        if (!this.gitApi) {
            throw new Error(
                'AzureDevOpsProvider not initialized. Call initialize() first.'
            );
        }
        return this.gitApi;
    }

    private splitRepo(repoFullName: string): {
        project: string;
        repo: string;
    } {
        const [project, repo] = repoFullName.split('/');
        if (!project || !repo) {
            throw new Error(
                `Invalid Azure DevOps repo format "${repoFullName}". Expected "Project/Repo".`
            );
        }
        return { project, repo };
    }

    private extractOrgName(): string {
        // Handle both formats:
        //   https://dev.azure.com/myorg
        //   https://myorg.visualstudio.com
        const url = new URL(this.orgUrl);
        if (url.hostname === 'dev.azure.com') {
            // Path is "/myorg" or "/myorg/"
            return url.pathname.split('/').filter(Boolean)[0] ?? '';
        }
        // For visualstudio.com: hostname is "myorg.visualstudio.com"
        return url.hostname.split('.')[0];
    }

    private mapChangeType(
        changeType: VersionControlChangeType | undefined
    ): ProviderFile['status'] {
        if (changeType === undefined) {
            return 'modified';
        }

        // VersionControlChangeType is a flags enum; check primary bits
        if (changeType & VersionControlChangeType.Add) {
            return 'added';
        }
        if (changeType & VersionControlChangeType.Delete) {
            return 'deleted';
        }
        if (changeType & VersionControlChangeType.Rename) {
            return 'renamed';
        }
        if (changeType & VersionControlChangeType.Edit) {
            return 'modified';
        }

        return 'modified';
    }
}
