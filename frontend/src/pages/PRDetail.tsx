import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, GitBranch, User } from 'lucide-react';
import { usePRReviews } from '../hooks/useReviews';
import { PRTimeline } from '../components/PRTimeline';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorAlert } from '../components/ErrorAlert';
import { EmptyState } from '../components/EmptyState';

export function PRDetail() {
  const { repo, prNumber } = useParams<{ repo: string; prNumber: string }>();
  const decodedRepo = decodeURIComponent(repo ?? '');
  const prNum = Number(prNumber);

  const { data, isLoading, error, refetch } = usePRReviews(decodedRepo, prNum);

  if (isLoading) {
    return <LoadingSpinner message="Loading PR reviews..." />;
  }

  if (error) {
    return (
      <ErrorAlert
        message="Failed to load PR details."
        onRetry={() => refetch()}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        title="PR not found"
        description="This pull request does not exist or has no reviews."
      />
    );
  }

  return (
    <div>
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* PR Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">{data.repo_full_name}</p>
        <h2 className="mt-1 text-xl font-bold text-gray-900">
          #{data.pr_number}: {data.pr_title}
        </h2>
        <div className="mt-3 flex items-center gap-4 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1">
            <User className="h-4 w-4" />
            {data.pr_author}
          </span>
          <span className="inline-flex items-center gap-1">
            <GitBranch className="h-4 w-4" />
            {data.branch_name}
          </span>
          <span className="text-gray-400">
            {data.reviews.length} review{data.reviews.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Review Timeline</h3>
        {data.reviews.length === 0 ? (
          <EmptyState
            title="No reviews yet"
            description="Reviews for this PR will appear here as commits are processed."
          />
        ) : (
          <PRTimeline reviews={data.reviews} />
        )}
      </div>
    </div>
  );
}
