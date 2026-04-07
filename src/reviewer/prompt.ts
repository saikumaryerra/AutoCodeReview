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
1. Use your file-reading tools to examine the full source files when you need more context (imports, type definitions, related functions, tests). Do not review the diff in isolation.
2. Focus on substantive issues: bugs, security vulnerabilities, performance problems, logic errors, race conditions, missing error handling. Do NOT nitpick formatting or style unless it causes a real problem.
3. Give positive feedback when you see well-written code.

RESPOND WITH ONLY VALID JSON matching this exact schema -- no markdown, no preamble, no explanation outside the JSON:

{
    "summary": "A 2-3 sentence summary of the overall quality of this change and its purpose.",
    "severity": "critical | warning | info | clean",
    "findings": [
        {
            "type": "bug | security | performance | style | maintainability | suggestion | praise",
            "severity": "critical | warning | info | praise",
            "file": "relative/path/to/file.ts",
            "line_start": 42,
            "line_end": 45,
            "title": "Short descriptive title",
            "description": "Detailed explanation of the issue and why it matters.",
            "suggestion": "Suggested fix or improvement, may include code.",
            "code_snippet": "The relevant lines of code"
        }
    ]
}

The top-level severity should be the highest severity among all findings. If there are no issues at all, use "clean" with an empty findings array (or only praise findings).
`.trim();
}
