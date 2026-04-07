import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, GitCommit, GitBranch, User, Clock, FileCode } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useReview } from '../hooks/useReviews';
import { SeverityBadge } from '../components/SeverityBadge';
import { ReviewBody } from '../components/ReviewBody';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorAlert } from '../components/ErrorAlert';
import { EmptyState } from '../components/EmptyState';

export function ReviewDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: review, isLoading, error, refetch } = useReview(id ?? '');

  if (isLoading) {
    return <LoadingSpinner message="Loading review..." />;
  }

  if (error) {
    return (
      <ErrorAlert
        message="Failed to load review details."
        onRetry={() => refetch()}
      />
    );
  }

  if (!review) {
    return (
      <EmptyState
        title="Review not found"
        description="This review does not exist or may have been deleted."
      />
    );
  }

  const createdDate = new Date(review.created_at);

  return (
    <div>
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-500">{review.repo_full_name}</p>
            <h2 className="mt-1 text-xl font-bold text-gray-900">
              <Link
                to={`/pr/${encodeURIComponent(review.repo_full_name)}/${review.pr_number}`}
                className="hover:text-indigo-600"
              >
                #{review.pr_number}: {review.pr_title}
              </Link>
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-600">
              <span className="inline-flex items-center gap-1">
                <User className="h-4 w-4" />
                {review.pr_author}
              </span>
              <span className="inline-flex items-center gap-1">
                <GitBranch className="h-4 w-4" />
                {review.branch_name}
              </span>
              <span className="inline-flex items-center gap-1">
                <GitCommit className="h-4 w-4" />
                <code className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5">
                  {review.commit_sha.slice(0, 7)}
                </code>
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span title={format(createdDate, 'PPpp')}>
                  {formatDistanceToNow(createdDate, { addSuffix: true })}
                </span>
              </span>
              <span className="inline-flex items-center gap-1">
                <FileCode className="h-4 w-4" />
                {review.stats.files_changed} files (+{review.stats.additions} -{review.stats.deletions})
              </span>
            </div>
          </div>
          <SeverityBadge severity={review.severity} className="text-sm px-3 py-1" />
        </div>

        {review.commit_message && (
          <p className="mt-3 text-sm text-gray-600 italic">
            &ldquo;{review.commit_message}&rdquo;
          </p>
        )}
      </div>

      {/* Summary */}
      {review.summary && (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Summary</h3>
          <p className="text-sm text-gray-700 leading-relaxed">{review.summary}</p>
        </div>
      )}

      {/* Findings */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Findings ({review.findings.length})
        </h3>
        <ReviewBody findings={review.findings} rawOutput={review.raw_output} />
      </div>
    </div>
  );
}
