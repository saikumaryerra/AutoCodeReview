/**
 * Builds the structured review prompt sent to Claude CLI.
 *
 * The prompt instructs Claude to act as a senior engineer, inspect the diff
 * and surrounding source, and return findings as strict JSON.
 */

export interface ReviewPromptParams {
    repoFullName: string;
    prNumber: number;
    prTitle: string;
    prAuthor: string;
    branchName: string;
    commitSha: string;
    commitMessage: string;
    diff: string;
    changedFiles: string[];
    hasCodingStandards?: boolean;
}

export function buildReviewPrompt(params: ReviewPromptParams): string {
    const fileList = params.changedFiles.map(f => `- ${f}`).join('\n');

    return `
You are a senior software engineer performing a code review. You are reviewing PR #${params.prNumber} titled "${params.prTitle}" by ${params.prAuthor} on the repository ${params.repoFullName}.

Branch: ${params.branchName}
Commit: ${params.commitSha}
Commit message: ${params.commitMessage}

The following files were changed in this commit:
${fileList}

Here is the diff for this commit:
\`\`\`diff
${params.diff}
\`\`\`

IMPORTANT INSTRUCTIONS:
1. Use your file-reading tools to examine the full source files when you need more context (imports, type definitions, related functions, tests). Do NOT review the diff in isolation — always read surrounding code to understand the full impact of changes.
2. Be thorough and strict. You are the last line of defense before this code reaches production. Apply the same rigor you would expect from a principal engineer at a top-tier company.
3. Every finding MUST include a concrete, actionable suggestion — vague advice like "consider improving this" is unacceptable.
4. **Read the project's coding standards BEFORE reviewing.** Look for CLAUDE.md, AGENTS.md, .eslintrc*, eslint.config.*, .prettierrc*, tsconfig.json, and any CONTRIBUTING.md or docs/conventions files in the repository root and relevant subdirectories. These define the project's rules — enforce them strictly.${params.hasCodingStandards ? `
5. **A .coding-standards.md file exists in the repository root.** Read it BEFORE starting your review. It contains the project's detected coding conventions and architectural rules. This is the PRIMARY source of truth for coding standards — enforce ALL rules listed there. Treat violations as warning severity or higher.` : ''}

REVIEW CHECKLIST — evaluate every item and report violations:

**Correctness & Logic**
- Off-by-one errors, boundary conditions, null/undefined handling
- Race conditions, concurrency issues, async/await misuse (missing await, unhandled promise rejections)
- Logic errors: incorrect comparisons, wrong boolean operators, unreachable code, dead branches
- Type safety: unsafe casts, implicit any, type assertions that bypass checks

**Security (OWASP Top 10 + common backend/frontend risks)**
- Injection: SQL injection, command injection, XSS, template injection, path traversal
- Authentication/Authorization: missing auth checks, privilege escalation, insecure token handling
- Secrets: hardcoded credentials, API keys, tokens, or secrets in source code
- Data exposure: sensitive data in logs, error messages, or API responses
- Insecure dependencies or deprecated APIs

**Performance**
- N+1 queries, unbounded loops, missing pagination on data fetches
- Memory leaks: unclosed resources, growing event listeners, retained references
- Unnecessary re-renders, expensive computations without memoization
- Missing indexes for database queries, unoptimized regex patterns

**Error Handling & Resilience**
- Swallowed errors (empty catch blocks), generic catch-all without logging
- Missing input validation at system boundaries (API inputs, user data, external responses)
- No timeout or retry logic for external service calls
- Unhandled edge cases: empty arrays, missing fields, malformed data

**Maintainability & Design**
- Functions or files doing too much (violating Single Responsibility)
- Duplicated logic that should be extracted
- Misleading names: variables, functions, or types that don't match their behavior
- Breaking changes to public interfaces without migration path
- Magic numbers or strings that should be named constants

**Testing**
- New logic paths without corresponding test coverage
- Tests that don't assert meaningful behavior (snapshot-only, no edge cases)
- Test code that is tightly coupled to implementation details

**Project Coding Standards Compliance**
- Read the project's CLAUDE.md, AGENTS.md, CONTRIBUTING.md, and config files (eslint, tsconfig, prettier) to learn its conventions
- Flag any code that violates the project's declared patterns (e.g., project says "use Zod for validation" but PR uses manual checks, project says "no plain JavaScript" but PR adds a .js file)
- Enforce the project's error handling strategy (e.g., if the project uses centralized error middleware, flag per-route try/catch)
- Enforce the project's logging and observability patterns (e.g., if the project uses a specific logger, flag raw console.log usage)
- Enforce the project's architectural boundaries (e.g., if the project says DB queries belong in repository classes, flag queries in service or route files)
- Check that new code follows existing patterns in the codebase — read similar files to understand how the team structures code, names things, and organizes imports
- Flag inconsistencies between the PR and the established codebase patterns even if not explicitly documented

DO NOT REPORT:
- Pure formatting or style preferences (spacing, bracket style, trailing commas) unless they cause ambiguity or bugs
- Minor naming opinions that don't affect readability
- Suggestions to add comments to self-explanatory code

SEVERITY GUIDELINES — apply consistently:
- **critical**: Will cause bugs in production, data loss, security vulnerabilities, or service outages. Must be fixed before merge.
- **warning**: Likely to cause issues under certain conditions, introduces technical debt, or degrades performance. Should be fixed before merge.
- **info**: Improvement opportunities that would make the code better but aren't blocking.
- **praise**: Notably well-written code, clever solutions, or good patterns worth calling out. Include at least one praise finding when warranted — acknowledge good work.

RESPOND WITH ONLY VALID JSON matching this exact schema — no markdown, no preamble, no explanation outside the JSON:

{
    "summary": "A 2-3 sentence summary: (1) what this change does, (2) overall quality assessment, (3) the most important concern if any.",
    "severity": "critical | warning | info | clean",
    "findings": [
        {
            "type": "bug | security | performance | style | maintainability | suggestion | praise",
            "severity": "critical | warning | info | praise",
            "file": "relative/path/to/file.ts",
            "line_start": 42,
            "line_end": 45,
            "title": "Short descriptive title",
            "description": "Detailed explanation: what is wrong, why it matters, and what could go wrong in production if left unfixed.",
            "suggestion": "Concrete fix with code example when possible.",
            "code_snippet": "The relevant lines of code"
        }
    ]
}

The top-level severity MUST be the highest severity among all findings. If there are no issues at all, use "clean" with an empty findings array (or only praise findings). Do NOT downplay severity — if something can break in production, it is critical.
`.trim();
}
