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
  const containerClass = className ? `h-full overflow-y-auto ${className}` : 'h-full overflow-y-auto';
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
        <div className="rounded-lg border border-gray-700/80 bg-gray-900/60 px-3 py-2">
          {metadata}
        </div>
      ) : null}
    </header>
  );
}

type PageNoticeTone = 'info' | 'success' | 'warning' | 'danger';

const NOTICE_CLASSES: Record<PageNoticeTone, string> = {
  info: 'border-sky-800 bg-sky-900/20 text-sky-100',
  success: 'border-green-800 bg-green-900/20 text-green-100',
  warning: 'border-amber-800 bg-amber-900/20 text-amber-100',
  danger: 'border-red-800 bg-red-900/20 text-red-100',
};

interface PageNoticeProps {
  title?: string;
  tone?: PageNoticeTone;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function PageNotice({
  title,
  tone = 'info',
  children,
  action,
  className,
}: PageNoticeProps) {
  const toneClass = NOTICE_CLASSES[tone];
  const mergedClassName = className
    ? `mb-4 rounded-lg border px-3 py-2 text-sm ${toneClass} ${className}`
    : `mb-4 rounded-lg border px-3 py-2 text-sm ${toneClass}`;
  return (
    <section className={mergedClassName} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="flex items-start justify-between gap-3">
        <div>
          {title ? (
            <h3 className="text-sm font-semibold">{title}</h3>
          ) : null}
          <div className={title ? 'mt-1 text-xs opacity-90' : 'text-xs opacity-90'}>
            {children}
          </div>
        </div>
        {action ? (
          <div className="shrink-0">
            {action}
          </div>
        ) : null}
      </div>
    </section>
  );
}

interface PageLoadingStateProps {
  label: string;
  className?: string;
}

export function PageLoadingState({ label, className }: PageLoadingStateProps) {
  const mergedClassName = className
    ? `flex items-center justify-center py-20 ${className}`
    : 'flex items-center justify-center py-20';

  return (
    <div className={mergedClassName} role="status" aria-label={label}>
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <span className="sr-only">{label}...</span>
    </div>
  );
}

interface PageEmptyStateProps {
  title: string;
  description: string;
  actions?: ReactNode;
  className?: string;
}

export function PageEmptyState({ title, description, actions, className }: PageEmptyStateProps) {
  const mergedClassName = className
    ? `rounded-lg border border-dashed border-gray-700 bg-gray-900/50 px-5 py-8 text-center ${className}`
    : 'rounded-lg border border-dashed border-gray-700 bg-gray-900/50 px-5 py-8 text-center';

  return (
    <section className={mergedClassName}>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-gray-400">{description}</p>
      {actions ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {actions}
        </div>
      ) : null}
    </section>
  );
}
