import type { ButtonHTMLAttributes } from 'react';
import { cx } from '@/components/ui/primitives/utils';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 focus:ring-indigo-500',
  secondary: 'bg-gray-700 text-gray-100 hover:bg-gray-600 focus:ring-gray-500',
  outline: 'border border-gray-600 text-gray-100 hover:bg-gray-800 focus:ring-gray-500',
  danger: 'bg-red-700 text-white hover:bg-red-600 focus:ring-red-500',
  ghost: 'text-gray-300 hover:text-white hover:bg-gray-800 focus:ring-gray-500',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'rounded-lg transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}

