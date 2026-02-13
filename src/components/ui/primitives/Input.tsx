import type { InputHTMLAttributes } from 'react';
import { cx } from '@/components/ui/primitives/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cx(
        'h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500',
        className,
      )}
      {...props}
    />
  );
}

