import { useEffect, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { WorkflowExecution, ExecutionLog, ExecutionStatus } from '@/types/workflow';
import { exportDebugBundle } from '@/lib/api/workflow';
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

function formatExportError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Failed to export debug bundle';
  }
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

  const handleCancel = () => send({ type: 'CANCEL_SELECTED' });
  const [exportState, setExportState] = useState<{
    isExporting: boolean;
    path: string | null;
    error: string | null;
  }>({
    isExporting: false,
    path: null,
    error: null,
  });

  const handleExportDebugBundle = async () => {
    if (!selectedExecutionId || exportState.isExporting) return;
    setExportState({ isExporting: true, path: null, error: null });
    try {
      const result = await exportDebugBundle(selectedExecutionId);
      setExportState({ isExporting: false, path: result.path, error: null });
    } catch (error) {
      const message = formatExportError(error);
      setExportState({ isExporting: false, path: null, error: message });
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
                  onClick={handleExportDebugBundle}
                  disabled={exportState.isExporting}
                  className="px-3 py-1.5 text-sm bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Export debug bundle"
                >
                  {exportState.isExporting ? 'Exporting...' : 'Export Debug Bundle'}
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
            {(exportState.path || exportState.error) && (
              <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/80 text-xs">
                {exportState.path && (
                  <p className="text-green-400">
                    Debug bundle exported to: <span className="font-mono">{exportState.path}</span>
                  </p>
                )}
                {exportState.error && (
                  <p className="text-red-400" role="alert">
                    {exportState.error}
                  </p>
                )}
              </div>
            )}
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
