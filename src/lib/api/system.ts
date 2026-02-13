import { invoke } from '@tauri-apps/api/core';

export interface InitializationState {
  database: boolean;
  github_auth_attempted: boolean;
}

export async function isInitialized(): Promise<InitializationState> {
  return invoke('is_initialized');
}
