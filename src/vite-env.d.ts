/// <reference types="vite/client" />

declare global {
  interface Window {
    __E2E_STATE__?: {
      workflows: Array<Record<string, unknown>>;
      auth: Record<string, unknown>;
      executions: Array<Record<string, unknown>>;
      logsByExecutionId: Record<string, Array<Record<string, unknown>>>;
      invokeLog: Array<{ cmd: string; args: Record<string, unknown> }>;
      commandFailures: Record<string, string>;
      commandDelaysMs: Record<string, number>;
    };
  }
}

export {};
