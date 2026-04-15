import type { Review, Finding } from '../shared/types.js';

function sevIcon(s: string): string {
    switch (s) {
        case 'critical': return '🔴';
        case 'warning': return '🟡';
        case 'info': return '🔵';
        case 'praise': return '🟢';
        case 'clean': return '✅';
        default: return '⚪';
    }
}

function findingLocation(f: Finding): string {
    if (!f.file) return '';
    if (f.line_start && f.line_end && f.line_end !== f.line_start) {
        return `\`${f.file}:${f.line_start}-${f.line_end}\``;
    }
    if (f.line_start) return `\`${f.file}:${f.line_start}\``;
    return `\`${f.file}\``;
}

export function formatReviewComment(review: Review): string {
    const lines: string[] = [
        `## 🤖 AutoCodeReview — ${sevIcon(review.severity)} ${review.severity.toUpperCase()}`,
        '',
        `**Commit:** \`${review.commit_sha.slice(0, 7)}\` · **Findings:** ${review.findings.length} · **Files changed:** ${review.stats.files_changed} (+${review.stats.additions} -${review.stats.deletions})`,
    ];

    if (review.summary) {
        lines.push('', '### Summary', '', review.summary);
    }

    if (review.findings.length > 0) {
        lines.push('', `### Findings (${review.findings.length})`);

        const order = ['critical', 'warning', 'info', 'praise'];
        const grouped = new Map<string, Finding[]>();
        for (const f of review.findings) {
            const arr = grouped.get(f.severity) ?? [];
            arr.push(f);
            grouped.set(f.severity, arr);
        }

        for (const sev of order) {
            const items = grouped.get(sev);
            if (!items || items.length === 0) continue;
            lines.push('', `#### ${sevIcon(sev)} ${sev} (${items.length})`);
            for (const f of items) {
                const loc = findingLocation(f);
                lines.push('', `- **${f.title}**${loc ? ` — ${loc}` : ''}`);
                if (f.description) {
                    lines.push(`  ${f.description.replace(/\n/g, '\n  ')}`);
                }
                if (f.suggestion) {
                    lines.push(`  _Suggestion:_ ${f.suggestion.replace(/\n/g, '\n  ')}`);
                }
            }
        }
    } else {
        lines.push('', '_No findings._');
    }

    lines.push('', '---', `_Posted by AutoCodeReview${review.claude_model ? ` · model: ${review.claude_model}` : ''}_`);
    return lines.join('\n');
}
