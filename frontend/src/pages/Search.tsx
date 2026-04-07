import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchBar } from '../components/SearchBar';
import { ReviewCard } from '../components/ReviewCard';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorAlert } from '../components/ErrorAlert';
import { EmptyState } from '../components/EmptyState';
import { useReviews } from '../hooks/useReviews';
import { useRepos } from '../hooks/useRepos';
import type { SearchType } from '../components/SearchBar';
import type { Severity, ReviewStatus, ReviewListParams } from '../types';

const severityOptions: Severity[] = ['critical', 'warning', 'info', 'clean'];
const statusOptions: ReviewStatus[] = ['completed', 'failed', 'skipped', 'pending', 'in_progress'];
const dateRangeOptions = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'All time', value: 'all' },
];

export function Search() {
  const navigate = useNavigate();
  const [params, setParams] = useState<ReviewListParams>({ limit: 20, page: 1 });
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [selectedSeverity, setSelectedSeverity] = useState<Severity | ''>('');
  const [selectedStatus, setSelectedStatus] = useState<ReviewStatus | ''>('');
  const [selectedDateRange, setSelectedDateRange] = useState<string>('all');
  const [hasSearched, setHasSearched] = useState(false);

  const { data: reposData } = useRepos();
  const repos = reposData ?? [];

  const { data: reviewsData, isLoading, error, refetch } = useReviews(params);
  const reviews = reviewsData?.data ?? [];
  const pagination = reviewsData?.pagination;

  const buildParams = useCallback(
    (overrides: Partial<ReviewListParams> = {}): ReviewListParams => {
      const p: ReviewListParams = { limit: 20, page: 1, ...overrides };
      if (selectedRepo) p.repo = selectedRepo;
      if (selectedSeverity) p.severity = selectedSeverity;
      if (selectedStatus) p.status = selectedStatus;
      return p;
    },
    [selectedRepo, selectedSeverity, selectedStatus]
  );

  const handleSearch = useCallback(
    (type: SearchType, value: string) => {
      if (type === 'commit') {
        navigate(`/review/commit/${value}`);
        return;
      }

      const newParams = buildParams();
      if (type === 'pr') {
        newParams.pr = Number(value);
      }
      setParams(newParams);
      setHasSearched(true);
    },
    [buildParams, navigate]
  );

  const handleFilterChange = useCallback(() => {
    const newParams = buildParams();
    setParams(newParams);
    setHasSearched(true);
  }, [buildParams]);

  const handleRepoChange = (value: string) => {
    setSelectedRepo(value);
    setTimeout(() => {
      const newParams = buildParams();
      if (value) newParams.repo = value;
      else delete newParams.repo;
      setParams(newParams);
      setHasSearched(true);
    }, 0);
  };

  const handleSeverityChange = (value: string) => {
    setSelectedSeverity(value as Severity | '');
    setTimeout(() => {
      const newParams = buildParams();
      if (value) newParams.severity = value as Severity;
      else delete newParams.severity;
      setParams(newParams);
      setHasSearched(true);
    }, 0);
  };

  const handleStatusChange = (value: string) => {
    setSelectedStatus(value as ReviewStatus | '');
    setTimeout(() => {
      const newParams = buildParams();
      if (value) newParams.status = value as ReviewStatus;
      else delete newParams.status;
      setParams(newParams);
      setHasSearched(true);
    }, 0);
  };

  const goToPage = (page: number) => {
    setParams((prev) => ({ ...prev, page }));
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900">Search Reviews</h2>
      <p className="mt-1 text-sm text-gray-500">
        Find reviews by PR number, commit SHA, or title.
      </p>

      <div className="mt-6">
        <SearchBar onSearch={handleSearch} />
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-3">
        <select
          value={selectedRepo}
          onChange={(e) => handleRepoChange(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All Repositories</option>
          {repos.map((r) => (
            <option key={r.id} value={r.full_name}>
              {r.full_name}
            </option>
          ))}
        </select>

        <select
          value={selectedSeverity}
          onChange={(e) => handleSeverityChange(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm capitalize focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All Severities</option>
          {severityOptions.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </select>

        <select
          value={selectedStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>

        <select
          value={selectedDateRange}
          onChange={(e) => {
            setSelectedDateRange(e.target.value);
            handleFilterChange();
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {dateRangeOptions.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {/* Results */}
      <div className="mt-6">
        {isLoading ? (
          <LoadingSpinner message="Searching..." />
        ) : error ? (
          <ErrorAlert
            message="Failed to load search results."
            onRetry={() => refetch()}
          />
        ) : !hasSearched ? (
          <EmptyState
            title="Start searching"
            description="Enter a PR number, commit SHA, or title above, or use the filters to browse reviews."
          />
        ) : reviews.length === 0 ? (
          <EmptyState
            title="No results found"
            description="Try adjusting your search query or filters."
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-gray-500">
              {pagination?.total ?? reviews.length} result{(pagination?.total ?? reviews.length) !== 1 ? 's' : ''} found
            </p>
            <div className="space-y-3">
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>

            {/* Pagination */}
            {pagination && pagination.total_pages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  onClick={() => goToPage(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600">
                  Page {pagination.page} of {pagination.total_pages}
                </span>
                <button
                  onClick={() => goToPage(pagination.page + 1)}
                  disabled={pagination.page >= pagination.total_pages}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
