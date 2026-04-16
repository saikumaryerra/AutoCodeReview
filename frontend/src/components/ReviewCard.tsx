import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GitCommit, MessageSquare, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { SeverityBadge } from './SeverityBadge';
import { StatusBadge } from './StatusBadge';
import { PrStateBadge } from './PrStateBadge';
import { reviewsApi } from '../api/client';
import type { ReviewListItem } from '../types';

interface ReviewCardProps {
  review: ReviewListItem;
}

export function ReviewCard({ review }: ReviewCardProps) {
  const queryClient = useQueryClient();
  const [reReviewing, setReReviewing] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const isInFlight = review.status === 'pending' || review.status === 'in_progress';

  const handleReReview = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (reReviewing || isInFlight) return;

    setReReviewing(true);
    setFeedback(null);
    try {
      await reviewsApi.trigger({
        repo_full_name: review.repo_full_name,
        pr_number: review.pr_number,
        commit_sha: review.commit_sha,
        force: true,
      });
      setFeedback({ ok: true, message: 'Re-review queued' });
      // Refetch the dashboard list so the user sees the new pending state
      await queryClient.invalidateQueries({ queryKey: ['reviews'] });
      // Auto-clear feedback after a few seconds
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error ??
        (err as Error).message ??
        'Failed to queue re-review';
      setFeedback({ ok: false, message: msg });
      setTimeout(() => setFeedback(null), 5000);
    } finally {
      setReReviewing(false);
    }
  };

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
            {review.status !== 'completed' && (
              <StatusBadge status={review.status} />
            )}
            <SeverityBadge severity={review.severity} />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReReview}
              disabled={reReviewing || isInFlight}
              title={isInFlight ? 'Review already in progress' : 'Re-review this commit'}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`h-3 w-3 ${reReviewing ? 'animate-spin' : ''}`} />
              {reReviewing ? 'Queuing…' : 'Re-review'}
            </button>
            <span className="text-xs text-gray-400">
              {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`mt-3 rounded-md border px-3 py-1.5 text-xs ${
            feedback.ok
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {feedback.message}
        </div>
      )}
    </Link>
  );
}
