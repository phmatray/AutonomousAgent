import { vi } from 'vitest';
import { mockIPC } from '@tauri-apps/api/mocks';

export const mockInvoke = vi.fn();

export function initializeTauriMocking() {
  mockIPC((cmd, payload) => {
    const normalizedPayload =
      payload != null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 0
        ? undefined
        : payload;

    if (normalizedPayload === undefined) {
      return mockInvoke(cmd);
    }

    return mockInvoke(cmd, normalizedPayload);
  }, { shouldMockEvents: true });
}
