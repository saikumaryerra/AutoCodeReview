import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { SeverityBadge } from './SeverityBadge';
import { StatusBadge } from './StatusBadge';
import type { PRReviewItem, Severity } from '../types';

const dotColors: Record<Severity, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
  clean: 'bg-green-500',
  praise: 'bg-purple-500',
};

interface PRTimelineProps {
  reviews: PRReviewItem[];
}

export function PRTimeline({ reviews }: PRTimelineProps) {
  const sorted = [...reviews].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div className="relative">
      {sorted.map((review, index) => {
        const isLast = index === sorted.length - 1;
        return (
          <div key={review.id} className="relative flex gap-4 pb-8">
            {/* Connecting line */}
            {!isLast && (
              <div className="absolute left-[9px] top-5 h-full w-0.5 bg-gray-200" />
            )}

            {/* Dot */}
            <div
              className={`relative z-10 mt-1 h-5 w-5 shrink-0 rounded-full border-2 border-white shadow ${dotColors[review.severity]}`}
            />

            {/* Content */}
            <Link
              to={`/review/${review.id}`}
              className="flex-1 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">
                      {review.commit_sha.slice(0, 7)}
                    </code>
                    {review.status !== 'completed' && (
                      <StatusBadge status={review.status} />
                    )}
                    <SeverityBadge severity={review.severity} />
                  </div>
                  <p className="mt-1.5 text-sm text-gray-800 truncate">
                    {review.commit_message}
                  </p>
                  <p className="mt-1 text-sm text-gray-600 line-clamp-2">
                    {review.summary}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
                  </span>
                  <span className="text-xs text-gray-500">
                    {review.findings_count} finding{review.findings_count !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
