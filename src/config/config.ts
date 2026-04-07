import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const splitCsv = (val: string | undefined): string[] =>
    (val || '').split(',').map(s => s.trim()).filter(Boolean);

const ConfigSchema = z.object({
    github: z.object({
        token: z.string().optional(),
        repos: z.array(z.string().regex(/^[^/]+\/[^/]+$/)).default([]),
    }),
    azureDevOps: z.object({
        token: z.string().optional(),
        orgUrl: z.string().url().optional(),
        repos: z.array(z.string().regex(/^[^/]+\/[^/]+$/)).default([]),
    }),
    polling: z.object({
        intervalSeconds: z.number().min(30).default(3600),
    }),
    claude: z.object({
        cliPath: z.string().default('claude'),
        reviewTimeoutSeconds: z.number().min(60).default(300),
        model: z.string().optional(),
    }),
    server: z.object({
        apiPort: z.number().default(3001),
        frontendPort: z.number().default(5173),
    }),
    storage: z.object({
        dbPath: z.string().default('./data/reviews.db'),
        reposDir: z.string().default('./data/repos'),
    }),
    review: z.object({
        prStateFilter: z.enum(['open', 'closed', 'all']).default('open'),
        skipDrafts: z.boolean().default(true),
        maxFilesChanged: z.number().default(50),
        maxDiffSize: z.number().default(100000),
        retentionDays: z.number().min(0).default(90),
    }),
}).refine(
    (cfg) => cfg.github.repos.length > 0 || cfg.azureDevOps.repos.length > 0,
    { message: 'At least one provider must have repos configured (GITHUB_REPOS or AZURE_DEVOPS_REPOS)' }
).refine(
    (cfg) => cfg.github.repos.length === 0 || (cfg.github.token && cfg.github.token.length > 0),
    { message: 'GITHUB_TOKEN is required when GITHUB_REPOS is configured' }
).refine(
    (cfg) => cfg.azureDevOps.repos.length === 0 || (cfg.azureDevOps.token && cfg.azureDevOps.orgUrl),
    { message: 'AZURE_DEVOPS_TOKEN and AZURE_DEVOPS_ORG_URL are required when AZURE_DEVOPS_REPOS is configured' }
);

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
    return ConfigSchema.parse({
        github: {
            token: process.env.GITHUB_TOKEN || undefined,
            repos: splitCsv(process.env.GITHUB_REPOS),
        },
        azureDevOps: {
            token: process.env.AZURE_DEVOPS_TOKEN || undefined,
            orgUrl: process.env.AZURE_DEVOPS_ORG_URL || undefined,
            repos: splitCsv(process.env.AZURE_DEVOPS_REPOS),
        },
        polling: {
            intervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS) || 3600,
        },
        claude: {
            cliPath: process.env.CLAUDE_CLI_PATH || 'claude',
            reviewTimeoutSeconds: Number(process.env.CLAUDE_REVIEW_TIMEOUT_SECONDS) || 300,
            model: process.env.CLAUDE_MODEL || undefined,
        },
        server: {
            apiPort: Number(process.env.API_PORT) || 3001,
            frontendPort: Number(process.env.FRONTEND_PORT) || 5173,
        },
        storage: {
            dbPath: process.env.DB_PATH || './data/reviews.db',
            reposDir: process.env.REPOS_DIR || './data/repos',
        },
        review: {
            prStateFilter: process.env.PR_STATE_FILTER || 'open',
            skipDrafts: process.env.SKIP_DRAFTS !== 'false',
            maxFilesChanged: Number(process.env.MAX_FILES_CHANGED) || 50,
            maxDiffSize: Number(process.env.MAX_DIFF_SIZE) || 100000,
            retentionDays: Number(process.env.REVIEW_RETENTION_DAYS ?? 90),
        },
    });
}
