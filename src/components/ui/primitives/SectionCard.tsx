import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cx } from '@/components/ui/primitives/utils';

interface SectionCardProps<T extends ElementType = 'section'> {
  as?: T;
  children: ReactNode;
  className?: string;
}

export function SectionCard<T extends ElementType = 'section'>({
  as,
  children,
  className,
  ...props
}: SectionCardProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof SectionCardProps<T>>) {
  const Component = as ?? 'section';
  return (
    <Component
      className={cx(
        'bg-gray-800 border border-gray-700 rounded-lg p-6',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

