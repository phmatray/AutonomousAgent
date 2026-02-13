import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialsPage } from '@/app/routes/credentials/CredentialsPage';
import { mockInvoke } from '@/test/mocks/tauri';

const GITHUB_TOKEN_AUTOFILL_STORAGE_KEY = 'credentials.github.token_autofill';

function installLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));

  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });
}

function mockCredentialCommands(options?: {
  savedToken?: string | null;
  savedTokenError?: Error;
  credentials?: Array<{
    id: string;
    username: string;
    label: string;
    is_default: boolean;
  }>;
  auditEvents?: Array<{
    id: string;
    provider: string;
    action: string;
    success: boolean;
    detail?: string;
    timestamp: string;
  }>;
}) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'get_auth_status') {
      return Promise.resolve({ authenticated: false });
    }
    if (cmd === 'get_claude_credential_status') {
      return Promise.resolve({ configured: false, account_label: null });
    }
    if (cmd === 'get_saved_github_token') {
      if (options?.savedTokenError) {
        return Promise.reject(options.savedTokenError);
      }
      return Promise.resolve({ token: options?.savedToken ?? null });
    }
    if (cmd === 'authenticate_github') {
      return Promise.resolve({ success: true, username: 'test-user' });
    }
    if (cmd === 'list_github_credentials') {
      return Promise.resolve(
        options?.credentials ?? [{
          id: 'test-user',
          username: 'test-user',
          label: 'test-user',
          is_default: true,
        }],
      );
    }
    if (cmd === 'delete_github_token') {
      return Promise.resolve(null);
    }
    if (cmd === 'delete_github_credential') {
      return Promise.resolve(null);
    }
    if (cmd === 'verify_github_token') {
      return Promise.resolve({ valid: true, username: 'test-user' });
    }
    if (cmd === 'list_credential_audit_events') {
      return Promise.resolve(options?.auditEvents ?? []);
    }
    if (cmd === 'save_claude_credential') {
      return Promise.resolve({ configured: true, account_label: null });
    }

    throw new Error(`Unhandled command: ${cmd}`);
  });
}

describe('CredentialsPage', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    installLocalStorageMock({
      [GITHUB_TOKEN_AUTOFILL_STORAGE_KEY]: 'true',
    });
  });

  it('restores a saved GitHub token on load', async () => {
    mockCredentialCommands({ savedToken: 'ghp_savedtoken123' });

    render(<CredentialsPage />);

    const input = screen.getByLabelText('Personal Access Token');
    await waitFor(() => {
      expect(input).toHaveValue('ghp_savedtoken123');
    });
  });

  it('keeps token input empty when restore fails', async () => {
    mockCredentialCommands({ savedTokenError: new Error('storage unavailable') });

    render(<CredentialsPage />);

    const input = screen.getByLabelText('Personal Access Token');
    await waitFor(() => {
      expect(input).toBeInTheDocument();
    });
    expect(input).toHaveValue('');
  });

  it('does not restore token when auto-fill is disabled', async () => {
    installLocalStorageMock({
      [GITHUB_TOKEN_AUTOFILL_STORAGE_KEY]: 'false',
    });
    mockCredentialCommands({ savedToken: 'ghp_savedtoken123' });

    render(<CredentialsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Personal Access Token')).toBeInTheDocument();
    });

    const calledRestore = mockInvoke.mock.calls.some(([cmd]) => cmd === 'get_saved_github_token');
    expect(calledRestore).toBe(false);
    expect(screen.getByLabelText('Personal Access Token')).toHaveValue('');
  });

  it('restores token after re-enabling auto-fill', async () => {
    const user = userEvent.setup();
    installLocalStorageMock({
      [GITHUB_TOKEN_AUTOFILL_STORAGE_KEY]: 'false',
    });
    mockCredentialCommands({ savedToken: 'ghp_savedtoken123' });

    render(<CredentialsPage />);

    const checkbox = screen.getByRole('checkbox', {
      name: 'Auto-fill saved token on page open',
    });

    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);

    await waitFor(() => {
      expect(screen.getByLabelText('Personal Access Token')).toHaveValue('ghp_savedtoken123');
    });
    expect(window.localStorage.getItem(GITHUB_TOKEN_AUTOFILL_STORAGE_KEY)).toBe('true');
  });

  it('verifies restored token before reveal', async () => {
    const user = userEvent.setup();
    mockCredentialCommands({ savedToken: 'ghp_savedtoken123' });

    render(<CredentialsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Personal Access Token')).toHaveValue('ghp_savedtoken123');
    });

    await user.click(screen.getByRole('button', { name: 'Verify and show token' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('verify_github_token', {
        token: 'ghp_savedtoken123',
      });
    });

    expect(screen.getByLabelText('Personal Access Token')).toHaveAttribute('type', 'text');
  });

  it('confirms before deleting saved token', async () => {
    const user = userEvent.setup();
    mockCredentialCommands({ savedToken: 'ghp_savedtoken123' });

    render(<CredentialsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove Saved Token' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Remove Saved Token' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Remove Saved GitHub Token')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Token' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('delete_github_token');
    });
  });

  it('removes a specific credential profile after confirmation', async () => {
    const user = userEvent.setup();
    mockCredentialCommands({
      savedToken: 'ghp_savedtoken123',
      credentials: [
        {
          id: 'alice',
          username: 'alice',
          label: 'alice',
          is_default: true,
        },
      ],
    });

    render(<CredentialsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove Profile' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Remove Profile' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Remove GitHub Credential Profile')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove Profile' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('delete_github_credential', {
        credentialId: 'alice',
      });
    });
  });

  it('supports credential activity date filtering and pagination', async () => {
    const user = userEvent.setup();
    mockCredentialCommands({
      auditEvents: [
        {
          id: 'audit-1',
          provider: 'github',
          action: 'save_token',
          success: true,
          timestamp: '2026-01-10T09:00:00.000Z',
        },
        {
          id: 'audit-2',
          provider: 'github',
          action: 'delete_token',
          success: true,
          timestamp: '2026-01-11T09:00:00.000Z',
        },
        {
          id: 'audit-3',
          provider: 'claude',
          action: 'save_credential',
          success: true,
          timestamp: '2026-01-12T09:00:00.000Z',
        },
        {
          id: 'audit-4',
          provider: 'github',
          action: 'save_token',
          success: true,
          timestamp: '2026-01-13T09:00:00.000Z',
        },
        {
          id: 'audit-5',
          provider: 'github',
          action: 'verify_reveal',
          success: true,
          timestamp: '2026-01-14T09:00:00.000Z',
        },
        {
          id: 'audit-6',
          provider: 'claude',
          action: 'save_credential',
          success: true,
          timestamp: '2026-01-15T09:00:00.000Z',
        },
      ],
    });

    render(<CredentialsPage />);

    await waitFor(() => {
      expect(screen.getByText('Showing 1-6 of 6 matching events.')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Page size'), '5');

    await waitFor(() => {
      expect(screen.getByText('Showing 1-5 of 6 matching events.')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('Showing 6-6 of 6 matching events.')).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText('From date'));
    await user.type(screen.getByLabelText('From date'), '2026-01-11');
    await user.clear(screen.getByLabelText('To date'));
    await user.type(screen.getByLabelText('To date'), '2026-01-12');

    await waitFor(() => {
      expect(screen.getByText('Showing 1-2 of 2 matching events.')).toBeInTheDocument();
    });
  });
});
