import type { HTMLAttributes } from 'react';
import { cx } from '@/components/ui/primitives/utils';

type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

const TONE_CLASSES: Record<BadgeTone, string> = {
  default: 'bg-gray-700 text-gray-300',
  success: 'bg-green-900/40 text-green-300 border border-green-800',
  warning: 'bg-amber-900/40 text-amber-300 border border-amber-800',
  danger: 'bg-red-900/40 text-red-300 border border-red-800',
  info: 'bg-sky-900/40 text-sky-200 border border-sky-800',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}

