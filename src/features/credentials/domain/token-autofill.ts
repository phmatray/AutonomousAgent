export const GITHUB_TOKEN_AUTOFILL_STORAGE_KEY = 'credentials.github.token_autofill';

function getBrowserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const storage = window.localStorage as Partial<Storage> | undefined;
  if (!storage) return null;
  if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return null;
  }
  return storage as Pick<Storage, 'getItem' | 'setItem'>;
}

export function getInitialGitHubTokenAutofill(): boolean {
  const raw = getBrowserStorage()?.getItem(GITHUB_TOKEN_AUTOFILL_STORAGE_KEY);
  return raw !== 'false';
}

export function persistGitHubTokenAutofill(enabled: boolean): void {
  getBrowserStorage()?.setItem(GITHUB_TOKEN_AUTOFILL_STORAGE_KEY, String(enabled));
}
