import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type NoticeTone = 'info' | 'warning' | 'error';

const TONES: Record<NoticeTone, string> = {
  info: 'border-gray-300 bg-white',
  warning: 'border-gray-500 border-dashed bg-gray-50',
  error: 'border-2 border-black bg-white',
};

const LABELS: Record<NoticeTone, string> = {
  info: 'Note',
  warning: 'Warning',
  error: 'Error',
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** Inline message. Errors use role="alert"; other tones use role="status". */
export function Notice({ tone = 'info', title, children, className }: NoticeProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded border px-4 py-3 text-sm text-charcoal', TONES[tone], className)}
    >
      <p className="font-semibold text-black">
        {LABELS[tone]}
        {title ? `: ${title}` : ''}
      </p>
      <div className="mt-1 text-gray-700">{children}</div>
    </div>
  );
}
