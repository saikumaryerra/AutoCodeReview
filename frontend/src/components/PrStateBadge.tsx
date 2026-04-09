import type { PrState } from '../types';

const stateConfig: Record<PrState, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-green-100', text: 'text-green-800', label: 'Open' },
  merged: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Merged' },
  closed: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Closed' },
};

interface PrStateBadgeProps {
  state: PrState | null;
  className?: string;
}

export function PrStateBadge({ state, className = '' }: PrStateBadgeProps) {
  if (!state) return null;
  const config = stateConfig[state] ?? stateConfig.open;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text} ${className}`}
    >
      {config.label}
    </span>
  );
}
