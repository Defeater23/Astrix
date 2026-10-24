import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Restrained grayscale status indicator. Meaning is always carried by the text label,
 * never by tone alone.
 */
export type StatusTone = 'solid' | 'outline' | 'muted' | 'dashed';

const TONES: Record<StatusTone, string> = {
  solid: 'border-black bg-black text-white',
  outline: 'border-black bg-white text-black',
  muted: 'border-gray-300 bg-gray-100 text-gray-600',
  dashed: 'border-dashed border-gray-500 bg-white text-gray-600',
};

export interface StatusLabelProps {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}

export function StatusLabel({ tone = 'muted', children, className }: StatusLabelProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
