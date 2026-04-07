interface StatusIndicatorProps {
  available: boolean;
  label?: string;
}

export function StatusIndicator({ available, label }: StatusIndicatorProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${
          available ? 'bg-green-500' : 'bg-red-500'
        }`}
        aria-label={available ? 'Available' : 'Unavailable'}
      />
      {label && <span className="text-sm text-gray-600">{label}</span>}
    </span>
  );
}
