import { Link } from 'react-router-dom';
import { GitBranch, GitCommit, Layers, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { SeverityBadge } from './SeverityBadge';
import { StatusBadge } from './StatusBadge';
import { PrStateBadge } from './PrStateBadge';
import type { PRListItem } from '../types';

interface PRCardProps {
  pr: PRListItem;
}

export function PRCard({ pr }: PRCardProps) {
  const href = `/pr/${encodeURIComponent(pr.repo_full_name)}/${pr.pr_number}`;

  return (
    <Link
      to={href}
      className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-500 truncate">
            {pr.repo_full_name}
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900 truncate">
            #{pr.pr_number}: {pr.pr_title}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              {pr.pr_author}
            </span>
            <span className="inline-flex items-center gap-1">
              <GitBranch className="h-3.5 w-3.5" />
              <span className="truncate max-w-[140px]">{pr.branch_name}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" />
              {pr.review_count} review{pr.review_count !== 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1">
              <GitCommit className="h-3.5 w-3.5" />
              <code className="font-mono">{pr.latest_commit_sha.slice(0, 7)}</code>
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <PrStateBadge state={pr.pr_state} />
            {pr.latest_status !== 'completed' && (
              <StatusBadge status={pr.latest_status} />
            )}
            <SeverityBadge severity={pr.latest_severity} />
          </div>
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(pr.latest_review_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </Link>
  );
}
