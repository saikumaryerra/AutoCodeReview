import { useState, useMemo } from 'react';
import { Activity, Clock, AlertTriangle, Timer, ChevronLeft, ChevronRight } from 'lucide-react';
import { usePRs } from '../hooks/usePRs';
import { useStatus } from '../hooks/useStatus';
import { PRCard } from '../components/PRCard';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorAlert } from '../components/ErrorAlert';
import { EmptyState } from '../components/EmptyState';
import type { Severity, PrState, PRListParams } from '../types';

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

const PAGE_SIZE = 10;

export function Dashboard() {
  const { data: status, isLoading: statusLoading, error: statusError, refetch: refetchStatus } = useStatus();

  // ── Filter & pagination state ──────────────────────────
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState<Severity | ''>('');
  const [prStateFilter, setPrStateFilter] = useState<PrState | ''>('');
  const [sortBy, setSortBy] = useState<'latest_review_at' | 'pr_number' | 'severity'>('latest_review_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const params: PRListParams = {
    page,
    limit: PAGE_SIZE,
    ...(severityFilter && { severity: severityFilter }),
    ...(prStateFilter && { pr_state: prStateFilter }),
    sort: sortBy,
    order: sortOrder,
  };

  const { data: prsData, isLoading: prsLoading, error: prsError, refetch: refetchPRs } = usePRs(params);

  const prs = prsData?.data ?? [];
  const pagination = prsData?.pagination;
  const totalPages = pagination?.total_pages ?? 1;

  // Reset to page 1 when filters change
  const handleSeverityChange = (v: string) => {
    setSeverityFilter(v as Severity | '');
    setPage(1);
  };
  const handlePrStateChange = (v: string) => {
    setPrStateFilter(v as PrState | '');
    setPage(1);
  };
  const handleSortChange = (v: string) => {
    setSortBy(v as 'latest_review_at' | 'pr_number' | 'severity');
    setPage(1);
  };
  const handleOrderChange = (v: string) => {
    setSortOrder(v as 'asc' | 'desc');
    setPage(1);
  };

  // Breakdown is computed over the visible page's latest-review severities.
  // It's a snapshot of what's currently on screen, consistent with prior behavior.
  const severityBreakdown = useMemo(() => {
    const counts: Record<Severity, number> = {
      critical: 0,
      warning: 0,
      info: 0,
      clean: 0,
      praise: 0,
    };
    for (const p of prs) {
      if (counts[p.latest_severity] !== undefined) {
        counts[p.latest_severity]++;
      }
    }
    return counts;
  }, [prs]);

  const totalBreakdown = Object.values(severityBreakdown).reduce((a, b) => a + b, 0);

  const avgReviewTime = useMemo(() => {
    const durations = prs
      .filter((p) => p.latest_review_duration_ms != null)
      .map((p) => p.latest_review_duration_ms as number);
    if (durations.length === 0) return null;
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  }, [prs]);

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
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Recent PRs</h3>
            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => handleSortChange(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="latest_review_at">Sort by Latest Review</option>
                <option value="pr_number">Sort by PR #</option>
                <option value="severity">Sort by Severity</option>
              </select>
              <select
                value={sortOrder}
                onChange={(e) => handleOrderChange(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="desc">Newest First</option>
                <option value="asc">Oldest First</option>
              </select>
              <select
                value={prStateFilter}
                onChange={(e) => handlePrStateChange(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All PRs</option>
                <option value="open">Open</option>
                <option value="merged">Merged</option>
                <option value="closed">Closed</option>
              </select>
              <select
                value={severityFilter}
                onChange={(e) => handleSeverityChange(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All Severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
                <option value="clean">Clean</option>
              </select>
            </div>
          </div>

          {prsLoading ? (
            <LoadingSpinner message="Loading PRs..." />
          ) : prsError ? (
            <ErrorAlert
              message="Failed to load recent PRs."
              onRetry={() => refetchPRs()}
            />
          ) : prs.length === 0 ? (
            <EmptyState
              title="No PRs found"
              description={
                severityFilter || prStateFilter
                  ? 'No PRs match the current filters.'
                  : 'PRs will appear here once pull requests are processed.'
              }
            />
          ) : (
            <>
              <div className="space-y-3">
                {prs.map((pr) => (
                  <PRCard key={`${pr.repo_full_name}#${pr.pr_number}`} pr={pr} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    Page {page} of {totalPages}
                    {pagination && (
                      <span className="ml-1 text-gray-400">
                        ({pagination.total} total)
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (page <= 3) {
                        pageNum = i + 1;
                      } else if (page >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = page - 2 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium ${
                            pageNum === page
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
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
