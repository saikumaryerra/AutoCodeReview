import type { ReviewStatus } from '../types';

const statusConfig: Record<ReviewStatus, { bg: string; text: string; label: string }> = {
  completed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Completed' },
  failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
  skipped: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Skipped' },
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'In Progress' },
};

interface StatusBadgeProps {
  status: ReviewStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.pending;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text} ${className}`}
    >
      {config.label}
    </span>
  );
}
