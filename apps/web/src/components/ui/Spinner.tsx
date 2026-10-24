import { cn } from '../../lib/cn';

export interface SpinnerProps {
  label?: string;
  className?: string;
}

/** Loading indicator with an accessible text label. */
export function Spinner({ label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-2 text-sm text-gray-600', className)}
    >
      <span
        aria-hidden="true"
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-black"
      />
      {label}…
    </span>
  );
}
