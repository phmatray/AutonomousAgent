import { useEffect, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { WorkflowExecution, ExecutionLog, ExecutionStatus } from '@/types/workflow';
import { copyDebugBundle } from '@/lib/api/workflow';
import { useRouter } from '@/lib/router';
import { monitoringMachine } from './monitoring-machine';

const STATUS_STYLES: Record<ExecutionStatus, string> = {
  IDLE: 'bg-gray-700 text-gray-300',
  SCHEDULED: 'bg-blue-900 text-blue-300',
  RUNNING: 'bg-yellow-900 text-yellow-300',
  PAUSED: 'bg-orange-900 text-orange-300',
  COMPLETED: 'bg-green-900 text-green-300',
  FAILED: 'bg-red-900 text-red-300',
  CANCELLED: 'bg-gray-700 text-gray-400',
};

const LOG_LEVEL_STYLES: Record<string, string> = {
  DEBUG: 'text-gray-500',
  INFO: 'text-blue-400',
  WARN: 'text-yellow-400',
  ERROR: 'text-red-400',
};

interface ExecutionContextEntry {
  node_id?: string;
  status?: string;
  output?: Record<string, unknown> | null;
  error?: string | null;
}

function formatExportError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Failed to export debug bundle';
  }
}

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

function getExecutionContextEntries(context: unknown): ExecutionContextEntry[] {
  if (!Array.isArray(context)) return [];
  return context.filter((entry): entry is ExecutionContextEntry =>
    typeof entry === 'object' && entry !== null,
  );
}

function NodeOutputsPanel({ contextEntries }: { contextEntries: ExecutionContextEntry[] }) {
  const completedWithOutput = contextEntries.filter(
    (entry) => entry.status === 'COMPLETED' && entry.output && Object.keys(entry.output).length > 0,
  );

  if (completedWithOutput.length === 0) {
    return (
      <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/80">
        <p className="text-xs text-gray-500">No node outputs available for this execution.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/80 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Node Outputs</h4>
      {completedWithOutput.map((entry, outputIndex) => {
        const output = entry.output ?? {};
        const issues = Array.isArray(output.issues) ? output.issues : null;
        return (
          <div key={`${entry.node_id ?? 'unknown'}-${outputIndex}`} className="rounded border border-gray-700 bg-gray-900/60 p-3">
            <p className="text-xs text-gray-400 mb-2">
              Node: <span className="font-mono text-gray-300">{entry.node_id ?? 'unknown'}</span>
            </p>
            {issues && (
              <div className="mb-2">
                <p className="text-xs text-blue-300 mb-1">Issues ({issues.length})</p>
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {issues.map((issue, idx) => {
                    const item = issue as Record<string, unknown>;
                    const title = typeof item.title === 'string' ? item.title : 'Untitled issue';
                    const number = typeof item.number === 'number' ? `#${item.number}` : '';
                    return (
                      <li key={`${entry.node_id}-${idx}`} className="text-xs text-gray-300">
                        {number} {title}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <details>
              <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-300">
                View raw output JSON
              </summary>
              <pre className="mt-2 text-xs text-gray-300 whitespace-pre-wrap break-all">
                {JSON.stringify(output, null, 2)}
              </pre>
            </details>
          </div>
        );
      })}
    </div>
  );
}

function ExecutionCard({
  execution,
  isSelected,
  onSelect,
}: {
  execution: WorkflowExecution;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`
        w-full text-left p-3 rounded-lg border transition-colors
        ${isSelected
          ? 'border-indigo-500 bg-indigo-900/20'
          : 'border-gray-700 bg-gray-800 hover:border-gray-600'
        }
      `}
      aria-label={`Execution ${execution.id.slice(0, 8)}, status: ${execution.status}`}
      aria-pressed={isSelected}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-mono text-gray-300">
          {execution.id.slice(0, 8)}
        </span>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[execution.status]}`}>
          {execution.status}
        </span>
      </div>
      {execution.startedAt && (
        <span className="text-xs text-gray-500">
          {new Date(execution.startedAt).toLocaleString()}
        </span>
      )}
    </button>
  );
}

function LogViewer({ logs, isStreaming }: { logs: ExecutionLog[]; isStreaming: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
        <h3 className="text-sm font-medium text-white">Execution Logs</h3>
        {isStreaming && (
          <span className="flex items-center gap-1.5 text-xs text-green-400" aria-live="polite">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" aria-hidden="true" />
            Live
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5"
        role="log"
        aria-label="Execution log output"
        aria-live="polite"
      >
        {logs.length === 0 && (
          <p className="text-gray-500 text-center py-8">
            No logs available. Select an execution to view logs.
          </p>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex gap-3">
            <span className="text-gray-600 flex-shrink-0">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span className={`flex-shrink-0 w-12 ${LOG_LEVEL_STYLES[log.level]}`}>
              {log.level}
            </span>
            {log.nodeId && (
              <span className="text-purple-400 flex-shrink-0">
                [{log.nodeId.slice(0, 8)}]
              </span>
            )}
            <span className="text-gray-300 break-all">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonitoringPage() {
  const { params } = useRouter();
  const requestedExecutionId = params.get('id');
  const [state, send] = useMachine(monitoringMachine);
  const executions = state.context.executions;
  const selectedExecutionId = state.context.selectedExecutionId;
  const logs = state.context.logs;
  const streamingLogs = state.context.streamingLogs;
  const executionsError = state.context.executionsError;
  const isLoadingExecutions = state.matches('loadingExecutions');
  const isFetchingExecutions = state.matches('refreshingExecutions');

  useEffect(() => {
    send({ type: 'REQUESTED_EXECUTION_CHANGED', executionId: requestedExecutionId });
  }, [requestedExecutionId, send]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    if (selectedExecutionId) {
      listen<ExecutionLog>(`execution-log-${selectedExecutionId}`, (event) => {
        send({ type: 'STREAM_LOG_RECEIVED', log: event.payload });
      }).then((fn) => {
        unlisten = fn;
      });
    }
    return () => {
      unlisten?.();
    };
  }, [selectedExecutionId, send]);

  const allLogs = [...logs, ...streamingLogs];
  const selectedExecution = executions.find((e) => e.id === selectedExecutionId);
  const isStreaming = selectedExecution?.status === 'RUNNING';
  const contextEntries = getExecutionContextEntries(selectedExecution?.context);

  const handleCancel = () => send({ type: 'CANCEL_SELECTED' });
  const [copyState, setCopyState] = useState<{
    isCopying: boolean;
    copied: 'none' | 'clipboard' | 'download';
    error: string | null;
  }>({
    isCopying: false,
    copied: 'none',
    error: null,
  });

  const handleCopyDebugBundle = async () => {
    if (!selectedExecutionId || copyState.isCopying) return;
    setCopyState({ isCopying: true, copied: 'none', error: null });
    try {
      const result = await copyDebugBundle(selectedExecutionId);
      try {
        await copyTextToClipboard(result.bundleJson);
        setCopyState({ isCopying: false, copied: 'clipboard', error: null });
      } catch {
        downloadDebugBundle(result.bundleJson);
        setCopyState({ isCopying: false, copied: 'download', error: null });
      }
    } catch (error) {
      const message = formatExportError(error);
      setCopyState({ isCopying: false, copied: 'none', error: message });
    }
  };

  return (
    <div className="flex h-full">
      <aside
        className="w-72 bg-gray-900 border-r border-gray-700 flex flex-col"
        aria-label="Execution list"
      >
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Executions</h2>
          <p className="text-xs text-gray-400 mt-1">
            Real-time workflow monitoring
          </p>
        </div>
        {executionsError && (
          <div className="mx-3 mt-3 p-2.5 rounded border border-red-800 bg-red-900/25 text-xs text-red-300" role="alert">
            <p>Could not load executions</p>
            <button
              type="button"
              onClick={() => send({ type: 'RETRY_EXECUTIONS' })}
              disabled={isFetchingExecutions}
              className="mt-2 px-2.5 py-1 rounded bg-red-800/70 text-red-100 hover:bg-red-700/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFetchingExecutions ? 'Retrying...' : 'Retry'}
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-3 space-y-2" role="list" aria-label="Workflow executions">
          {isLoadingExecutions && (
            <p className="text-sm text-gray-500 text-center py-8" role="status" aria-live="polite">
              Loading executions...
            </p>
          )}
          {!isLoadingExecutions && !executionsError && executions.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              No executions yet
            </p>
          )}
          {!executionsError && executions.map((exec) => (
            <div key={exec.id} role="listitem">
              <ExecutionCard
                execution={exec}
                isSelected={exec.id === selectedExecutionId}
                onSelect={() => send({ type: 'SELECT_EXECUTION', executionId: exec.id })}
              />
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 flex flex-col bg-gray-950">
        {selectedExecutionId ? (
          <>
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-900">
              <div>
                <span className="text-sm font-mono text-gray-300">
                  Execution: {selectedExecutionId.slice(0, 12)}
                </span>
                {selectedExecution && (
                  <span
                    className={`ml-3 px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[selectedExecution.status]}`}
                  >
                    {selectedExecution.status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyDebugBundle}
                  disabled={copyState.isCopying}
                  className="px-3 py-1.5 text-sm bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Copy debug bundle"
                >
                  {copyState.isCopying ? 'Copying...' : 'Copy Debug Bundle'}
                </button>
                {isStreaming && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-3 py-1.5 text-sm bg-red-700 text-white rounded hover:bg-red-600 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                    aria-label="Cancel execution"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </header>
            {(copyState.copied !== 'none' || copyState.error) && (
              <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/80 text-xs">
                {copyState.copied === 'clipboard' && (
                  <p className="text-green-400">
                    Debug bundle copied to clipboard.
                  </p>
                )}
                {copyState.copied === 'download' && (
                  <p className="text-green-400">
                    Clipboard unavailable. Debug bundle downloaded as JSON.
                  </p>
                )}
                {copyState.error && (
                  <p className="text-red-400" role="alert">
                    {copyState.error}
                  </p>
                )}
              </div>
            )}
            <NodeOutputsPanel contextEntries={contextEntries} />
            <LogViewer logs={allLogs} isStreaming={isStreaming} />
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            {executionsError ? (
              <p className="text-gray-500">Execution data unavailable. Retry from the left panel.</p>
            ) : isLoadingExecutions ? (
              <p className="text-gray-500">Loading executions...</p>
            ) : (
              <p className="text-gray-500">
                Select an execution to view logs
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
