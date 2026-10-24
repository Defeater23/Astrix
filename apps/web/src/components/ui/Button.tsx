import type { ButtonHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /**
   * When set, the button is disabled and the reason is exposed as a tooltip and to
   * assistive technology. Every control that cannot work yet must use this.
   */
  disabledReason?: string;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border border-black bg-black text-white hover:bg-charcoal',
  secondary: 'border border-gray-300 bg-white text-black hover:bg-gray-100',
  ghost: 'border border-transparent bg-transparent text-charcoal hover:bg-gray-200',
  danger: 'border-2 border-black bg-white text-black hover:bg-black hover:text-white',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabledReason,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const reasonId = useId();
  const isDisabled = Boolean(disabled || disabledReason || loading);

  return (
    <>
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        title={disabledReason}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded font-medium transition-colors',
          'disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-500',
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...rest}
      >
        {loading ? <span aria-hidden="true">…</span> : null}
        {children}
      </button>
      {disabledReason ? (
        <span id={reasonId} className="sr-only">
          Disabled: {disabledReason}
        </span>
      ) : null}
    </>
  );
});
