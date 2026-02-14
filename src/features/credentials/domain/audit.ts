import type { CredentialAuditEvent, GitHubCredential } from '@/lib/api/github';

export type AuditResultFilter = 'all' | 'success' | 'failure';
export const CREDENTIAL_AUDIT_FETCH_LIMIT = 200;
export const AUDIT_PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

export function formatAuditTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function toAuditActionLabel(event: CredentialAuditEvent): string {
  const actionMap: Record<string, string> = {
    save_token: 'Saved token',
    delete_token: 'Removed token',
    delete_credential: 'Removed credential',
    verify_reveal: 'Verified reveal',
    save_credential: 'Saved credential',
  };

  return actionMap[event.action] ?? event.action;
}

export function toAuditDateBoundary(dateValue: string, endOfDay: boolean): Date | null {
  const trimmed = dateValue.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function hasInvalidAuditDateRange(fromDate: string, toDate: string): boolean {
  const fromBoundary = toAuditDateBoundary(fromDate, false);
  const toBoundary = toAuditDateBoundary(toDate, true);
  return Boolean(fromBoundary && toBoundary && fromBoundary.getTime() > toBoundary.getTime());
}

export function filterCredentialAuditEvents(
  events: CredentialAuditEvent[],
  filters: {
    provider: string;
    action: string;
    result: AuditResultFilter;
    fromDate: string;
    toDate: string;
  },
): CredentialAuditEvent[] {
  const fromBoundary = toAuditDateBoundary(filters.fromDate, false);
  const toBoundary = toAuditDateBoundary(filters.toDate, true);

  return events.filter((event) => {
    if (filters.provider !== 'all' && event.provider !== filters.provider) {
      return false;
    }
    if (filters.action !== 'all' && event.action !== filters.action) {
      return false;
    }
    if (filters.result === 'success' && !event.success) {
      return false;
    }
    if (filters.result === 'failure' && event.success) {
      return false;
    }
    const eventTimestamp = new Date(event.timestamp);
    if (!Number.isNaN(eventTimestamp.getTime())) {
      if (fromBoundary && eventTimestamp < fromBoundary) {
        return false;
      }
      if (toBoundary && eventTimestamp > toBoundary) {
        return false;
      }
    }
    return true;
  });
}

export function filterGitHubCredentialsByQuery(
  credentials: GitHubCredential[],
  query: string,
): GitHubCredential[] {
  const normalizedSearch = query.trim().toLowerCase();
  if (!normalizedSearch) return credentials;
  return credentials.filter((credential) =>
    credential.label.toLowerCase().includes(normalizedSearch)
    || credential.id.toLowerCase().includes(normalizedSearch)
    || credential.username.toLowerCase().includes(normalizedSearch),
  );
}
