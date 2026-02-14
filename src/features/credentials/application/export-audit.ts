import type { CredentialAuditEvent } from '@/lib/api/github';

export function triggerCredentialAuditDownload(
  events: CredentialAuditEvent[],
  filters: Record<string, string>,
): void {
  if (typeof document === 'undefined') return;

  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const fileName = `credential-audit-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;

  const payload = JSON.stringify(
    {
      exported_at: now.toISOString(),
      filters,
      events,
    },
    null,
    2,
  );

  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
