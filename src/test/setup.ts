import '@testing-library/jest-dom/vitest';
import { beforeEach, afterEach } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import { mockInvoke, initializeTauriMocking } from './mocks/tauri';

beforeEach(() => {
  clearMocks();
  mockInvoke.mockReset();
  initializeTauriMocking();
});

afterEach(() => {
  clearMocks();
});
