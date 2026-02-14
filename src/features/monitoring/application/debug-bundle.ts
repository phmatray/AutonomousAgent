import {
  copyDebugBundle,
  type DebugBundleCredentialAuditFilter,
} from '@/lib/api/workflow';

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to legacy copy API for environments that block clipboard permissions.
    }
  }

  if (typeof document === 'undefined' || !document.body) {
    throw new Error('Clipboard is unavailable in this context');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('Failed to copy debug bundle to clipboard');
  }
}

function downloadDebugBundle(text: string): void {
  if (typeof document === 'undefined') {
    throw new Error('Unable to export debug bundle in this context');
  }

  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const fileName = `debug-bundle-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;

  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
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

export async function exportDebugBundle(
  executionId: string,
  credentialAuditFilter?: DebugBundleCredentialAuditFilter,
): Promise<'clipboard' | 'download'> {
  const result = await copyDebugBundle(executionId, credentialAuditFilter);
  try {
    await copyTextToClipboard(result.bundleJson);
    return 'clipboard';
  } catch {
    downloadDebugBundle(result.bundleJson);
    return 'download';
  }
}
