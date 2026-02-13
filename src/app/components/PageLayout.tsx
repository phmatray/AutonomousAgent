import type { ReactNode } from 'react';

type PageWidth = 'md' | 'lg' | 'xl';

const WIDTH_CLASSES: Record<PageWidth, string> = {
  md: 'max-w-2xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
};

interface CenteredPageProps {
  children: ReactNode;
  width?: PageWidth;
  className?: string;
}

export function CenteredPage({ children, width = 'xl', className }: CenteredPageProps) {
  const containerClass = className ? `flex-1 overflow-y-auto ${className}` : 'flex-1 overflow-y-auto';
  return (
    <div className={containerClass}>
      <div className={`mx-auto w-full ${WIDTH_CLASSES[width]} p-6`}>
        {children}
      </div>
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  metadata?: ReactNode;
}

export function PageHeader({ title, description, actions, metadata }: PageHeaderProps) {
  return (
    <header className="mb-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-gray-300">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {metadata ? (
        <div>
          {metadata}
        </div>
      ) : null}
    </header>
  );
}
