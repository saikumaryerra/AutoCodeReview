import { useMemo } from 'react';
import { Activity, Clock, AlertTriangle, Timer } from 'lucide-react';
import { useReviews } from '../hooks/useReviews';
import { useStatus } from '../hooks/useStatus';
import { ReviewCard } from '../components/ReviewCard';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorAlert } from '../components/ErrorAlert';
import { EmptyState } from '../components/EmptyState';
import type { Severity } from '../types';

const severityColors: Record<Severity, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
  clean: 'bg-green-500',
  praise: 'bg-purple-500',
};

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function Dashboard() {
  const { data: status, isLoading: statusLoading, error: statusError, refetch: refetchStatus } = useStatus();
  const { data: reviewsData, isLoading: reviewsLoading, error: reviewsError, refetch: refetchReviews } = useReviews({ limit: 20 });

  const reviews = reviewsData?.data ?? [];

  const severityBreakdown = useMemo(() => {
    const counts: Record<Severity, number> = {
      critical: 0,
      warning: 0,
      info: 0,
      clean: 0,
      praise: 0,
    };
    for (const r of reviews) {
      if (counts[r.severity] !== undefined) {
        counts[r.severity]++;
      }
    }
    return counts;
  }, [reviews]);

  const totalBreakdown = Object.values(severityBreakdown).reduce((a, b) => a + b, 0);

  const avgReviewTime = useMemo(() => {
    const durations = reviews
      .filter((r) => r.review_duration_ms != null)
      .map((r) => r.review_duration_ms as number);
    if (durations.length === 0) return null;
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  }, [reviews]);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
      <p className="mt-1 text-sm text-gray-500">Overview of recent code review activity.</p>

      {/* Stat Cards */}
      {statusError ? (
        <div className="mt-6">
          <ErrorAlert
            message="Failed to load system status."
            onRetry={() => refetchStatus()}
          />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Activity className="h-5 w-5 text-indigo-600" />}
            label="Reviews Today"
            value={statusLoading ? '--' : String(status?.reviews_today ?? 0)}
          />
          <StatCard
            icon={<Clock className="h-5 w-5 text-blue-600" />}
            label="In Queue"
            value={statusLoading ? '--' : String(status?.queue_depth ?? 0)}
          />
          <StatCard
            icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
            label="Critical Issues"
            value={statusLoading ? '--' : String(severityBreakdown.critical)}
            highlight={severityBreakdown.critical > 0}
          />
          <StatCard
            icon={<Timer className="h-5 w-5 text-green-600" />}
            label="Avg Review Time"
            value={statusLoading ? '--' : avgReviewTime ? formatDuration(avgReviewTime) : 'N/A'}
          />
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Recent Reviews */}
        <div className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Reviews</h3>
          {reviewsLoading ? (
            <LoadingSpinner message="Loading reviews..." />
          ) : reviewsError ? (
            <ErrorAlert
              message="Failed to load recent reviews."
              onRetry={() => refetchReviews()}
            />
          ) : reviews.length === 0 ? (
            <EmptyState
              title="No reviews yet"
              description="Reviews will appear here once pull requests are processed."
            />
          ) : (
            <div className="space-y-3">
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          )}
        </div>

        {/* Severity Breakdown */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Severity Breakdown</h3>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            {totalBreakdown === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No data available.</p>
            ) : (
              <div className="space-y-3">
                {(Object.entries(severityBreakdown) as [Severity, number][]).map(
                  ([severity, count]) => (
                    <div key={severity} className="flex items-center gap-3">
                      <div className={`h-3 w-3 rounded-full ${severityColors[severity]}`} />
                      <span className="flex-1 text-sm text-gray-700 capitalize">{severity}</span>
                      <span className="text-sm font-medium text-gray-900">{count}</span>
                      <div className="w-20 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${severityColors[severity]}`}
                          style={{ width: `${(count / totalBreakdown) * 100}%` }}
                        />
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}

function StatCard({ icon, label, value, highlight }: StatCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <p
        className={`mt-2 text-2xl font-bold ${
          highlight ? 'text-red-600' : 'text-gray-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
