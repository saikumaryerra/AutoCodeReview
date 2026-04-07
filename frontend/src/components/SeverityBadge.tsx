import type { Severity } from '../types';

const severityConfig: Record<Severity, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-100', text: 'text-red-800', label: 'Critical' },
  warning: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Warning' },
  info: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Info' },
  clean: { bg: 'bg-green-100', text: 'text-green-800', label: 'Clean' },
  praise: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Praise' },
};

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

export function SeverityBadge({ severity, className = '' }: SeverityBadgeProps) {
  const config = severityConfig[severity] ?? severityConfig.info;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text} ${className}`}
    >
      {config.label}
    </span>
  );
}
