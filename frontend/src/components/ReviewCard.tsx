import { Link } from 'react-router-dom';
import { GitCommit, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { SeverityBadge } from './SeverityBadge';
import { PrStateBadge } from './PrStateBadge';
import type { ReviewListItem } from '../types';

interface ReviewCardProps {
  review: ReviewListItem;
}

export function ReviewCard({ review }: ReviewCardProps) {
  return (
    <Link
      to={`/review/${review.id}`}
      className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-500 truncate">
            {review.repo_full_name}
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900 truncate">
            #{review.pr_number}: {review.pr_title}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <GitCommit className="h-3.5 w-3.5" />
              <code className="font-mono">{review.commit_sha.slice(0, 7)}</code>
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" />
              {review.findings_count} finding{review.findings_count !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <PrStateBadge state={review.pr_state} />
            <SeverityBadge severity={review.severity} />
          </div>
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </Link>
  );
}
