import { useEffect, useRef } from 'react';
import type {
  WorkflowExecution,
  ExecutionLog,
  ExecutionStatus,
} from '@/types/workflow';
import { useRouter } from '@/lib/router';
import { Badge, Input } from '@/components/ui/primitives';
import {
  EXECUTION_STATUS_FILTERS,
  MAX_DEBUG_BUNDLE_CREDENTIAL_EVENTS,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type ExecutionContextEntry,
  type LogDensityMode,
  type TimelineNodeState,
} from '@/features/monitoring/domain/monitoring';
import {
  useMonitoringModel,
  type DebugBundleExportMode,
  type DebugBundleResultFilter,
} from '@/features/monitoring/application/use-monitoring-model';

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

function NodeRunInspector({ contextEntries }: { contextEntries: ExecutionContextEntry[] }) {
  if (contextEntries.length === 0) {
    return null;
  }

  return (
    <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/80 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Run Inspector</h4>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {contextEntries.map((entry, index) => {
          const retries = entry.retry_count ?? 0;
          const durationMs = entry.duration_ms ?? 0;
          const status = entry.status ?? 'UNKNOWN';
          const statusColor = status === 'COMPLETED'
            ? 'text-green-300'
            : status === 'FAILED'
              ? 'text-red-300'
              : status === 'SKIPPED'
                ? 'text-yellow-300'
                : 'text-gray-300';

          return (
            <details key={`${entry.node_id ?? 'unknown'}-${index}`} className="rounded border border-gray-700 bg-gray-900/60 p-3">
              <summary className="cursor-pointer text-xs text-gray-200 flex items-center justify-between gap-2">
                <span className="font-mono">{entry.node_id ?? 'unknown'}</span>
                <span className={`font-medium ${statusColor}`}>{status}</span>
                <span className="text-gray-400">{durationMs}ms</span>
                <span className="text-gray-400">retries: {retries}</span>
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-gray-400">
                  Started: {entry.started_at ? new Date(entry.started_at).toLocaleString() : 'n/a'}
                </p>
                <p className="text-[11px] text-gray-400">
                  Completed: {entry.completed_at ? new Date(entry.completed_at).toLocaleString() : 'n/a'}
                </p>
                {entry.policy && (
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap break-all">
                    {JSON.stringify({ policy: entry.policy }, null, 2)}
                  </pre>
                )}
                {entry.resolved_config && (
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap break-all">
                    {JSON.stringify({ resolved_config: entry.resolved_config }, null, 2)}
                  </pre>
                )}
                {entry.input && (
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap break-all">
                    {JSON.stringify({ input: entry.input }, null, 2)}
                  </pre>
                )}
                {entry.output && (
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap break-all">
                    {JSON.stringify({ output: entry.output }, null, 2)}
                  </pre>
                )}
                {entry.error && (
                  <p className="text-xs text-red-300">
                    {entry.error}
                  </p>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function NodeTimelinePanel({ nodes }: { nodes: TimelineNodeState[] }) {
  if (nodes.length === 0) {
    return (
      <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/80">
        <p className="text-xs text-gray-500">No node activity yet.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/80">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-300 mb-3">Execution Timeline</h4>
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {nodes.map((node) => {
          const statusColor = node.status === 'COMPLETED'
            ? 'text-green-300 border-green-800/70'
            : node.status === 'FAILED'
              ? 'text-red-300 border-red-800/70'
              : node.status === 'SKIPPED'
                ? 'text-yellow-300 border-yellow-800/70'
                : 'text-blue-300 border-blue-800/70';
          return (
            <div key={node.nodeId} className={`rounded border bg-gray-900/60 px-3 py-2 ${statusColor}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{node.nodeId}</span>
                <span className="text-[11px] font-semibold">{node.status}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                <span>{node.nodeType}</span>
                <span>{node.durationMs ?? 0}ms</span>
              </div>
              {node.error && (
                <p className="mt-1 text-[11px] text-red-300">{node.error}</p>
              )}
            </div>
          );
        })}
      </div>
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

function LogViewer({
  logs,
  isStreaming,
  densityMode,
  onDensityModeChange,
}: {
  logs: ExecutionLog[];
  isStreaming: boolean;
  densityMode: LogDensityMode;
  onDensityModeChange: (mode: LogDensityMode) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-white">Execution Logs</h3>
          <span className="text-xs text-gray-500">{logs.length} entries</span>
          {isStreaming && (
            <span className="flex items-center gap-1.5 text-xs text-green-400" aria-live="polite">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" aria-hidden="true" />
              Live
            </span>
          )}
        </div>
        <div className="inline-flex items-center rounded border border-gray-700 bg-gray-900/70 p-0.5">
          <button
            type="button"
            onClick={() => onDensityModeChange('compact')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              densityMode === 'compact'
                ? 'bg-indigo-700 text-indigo-100'
                : 'text-gray-300 hover:bg-gray-800'
            }`}
            aria-pressed={densityMode === 'compact'}
          >
            Compact
          </button>
          <button
            type="button"
            onClick={() => onDensityModeChange('expanded')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              densityMode === 'expanded'
                ? 'bg-indigo-700 text-indigo-100'
                : 'text-gray-300 hover:bg-gray-800'
            }`}
            aria-pressed={densityMode === 'expanded'}
          >
            Expanded
          </button>
        </div>
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
          <div
            key={log.id}
            className={densityMode === 'expanded' ? 'rounded border border-gray-800 bg-gray-900/70 px-3 py-2 mb-1.5' : 'flex gap-3'}
          >
            <div className={densityMode === 'expanded' ? 'flex items-center gap-2 mb-1.5' : 'contents'}>
              <span className="text-gray-600 flex-shrink-0">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className={`flex-shrink-0 ${densityMode === 'expanded' ? 'px-1.5 py-0.5 rounded bg-gray-800 w-auto' : 'w-12'} ${LOG_LEVEL_STYLES[log.level]}`}>
                {log.level}
              </span>
              {log.nodeId && (
                <span className="text-purple-400 flex-shrink-0">
                  [{log.nodeId.slice(0, 8)}]
                </span>
              )}
            </div>
            <p className={`text-gray-300 ${densityMode === 'expanded' ? 'whitespace-pre-wrap break-words' : 'break-all'}`}>
              {log.message}
            </p>
            {densityMode === 'expanded' && log.metadata && Object.keys(log.metadata).length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-gray-400 hover:text-gray-300">
                  Metadata
                </summary>
                <pre className="mt-1 text-[11px] text-gray-300 whitespace-pre-wrap break-all">
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonitoringPage() {
  const { params } = useRouter();
  const requestedExecutionId = params.get('id');
  const {
    containerRef,
    send,
    executions,
    selectedExecutionId,
    executionsError,
    logsError,
    cancelError,
    isLoadingExecutions,
    isFetchingExecutions,
    sidebarWidth,
    logDensityMode,
    executionSearchQuery,
    executionStatusFilter,
    isResizing,
    timelineNodes,
    showAdvancedDiagnostics,
    allLogs,
    selectedExecution,
    isStreaming,
    executionStatusCounts,
    filteredExecutions,
    contextEntries,
    handleCancel,
    copyState,
    debugBundleExportMode,
    bundleCredentialProviderFilter,
    bundleCredentialActionFilter,
    bundleCredentialResultFilter,
    bundleCredentialFromDate,
    bundleCredentialToDate,
    bundleCredentialLimit,
    hasInvalidBundleDateRange,
    setLogDensityMode,
    setExecutionSearchQuery,
    setExecutionStatusFilter,
    setShowAdvancedDiagnostics,
    setDebugBundleExportMode,
    setBundleCredentialProviderFilter,
    setBundleCredentialActionFilter,
    setBundleCredentialResultFilter,
    setBundleCredentialFromDate,
    setBundleCredentialToDate,
    setBundleCredentialLimit,
    handleCopyDebugBundle,
    startResizing,
    handleResizeKeyDown,
  } = useMonitoringModel({ requestedExecutionId });

  return (
    <div ref={containerRef} className="flex h-full">
      <aside
        className="bg-gray-900 border-r border-gray-700 flex flex-col shrink-0"
        style={{ width: `${sidebarWidth}px` }}
        aria-label="Execution list"
      >
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Executions</h2>
            <button
              type="button"
              onClick={() => send({ type: 'REFRESH_EXECUTIONS' })}
              disabled={isFetchingExecutions}
              className="px-2 py-1 text-xs rounded border border-gray-600 text-gray-200 hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFetchingExecutions ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Real-time workflow monitoring
          </p>
          <div className="mt-3 space-y-2">
            <label className="block">
              <span className="sr-only">Search executions</span>
              <Input
                type="search"
                value={executionSearchQuery}
                onChange={(event) => setExecutionSearchQuery(event.target.value)}
                placeholder="Search by execution, workflow, or status"
                className="h-9 bg-gray-800 border-gray-700 text-xs"
                aria-label="Search executions"
              />
            </label>
            <div className="flex items-center gap-2">
              <label className="flex-1">
                <span className="sr-only">Filter executions by status</span>
                <select
                  value={executionStatusFilter}
                  onChange={(event) => setExecutionStatusFilter(event.target.value as 'ALL' | ExecutionStatus)}
                  className="h-9 w-full rounded border border-gray-700 bg-gray-800 px-2 text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Filter executions by status"
                >
                  {EXECUTION_STATUS_FILTERS.map((status) => (
                    <option key={status} value={status}>
                      {status === 'ALL' ? 'All statuses' : status}
                    </option>
                  ))}
                </select>
              </label>
              {(executionSearchQuery || executionStatusFilter !== 'ALL') ? (
                <button
                  type="button"
                  onClick={() => {
                    setExecutionSearchQuery('');
                    setExecutionStatusFilter('ALL');
                  }}
                  className="h-9 rounded border border-gray-700 px-2 text-xs text-gray-300 hover:border-gray-600 hover:text-white"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge tone={executionStatusCounts.RUNNING > 0 ? 'info' : 'default'} className="text-[11px]">
                Running {executionStatusCounts.RUNNING}
              </Badge>
              <Badge tone={executionStatusCounts.FAILED > 0 ? 'danger' : 'default'} className="text-[11px]">
                Failed {executionStatusCounts.FAILED}
              </Badge>
              <Badge tone="success" className="text-[11px]">
                Completed {executionStatusCounts.COMPLETED}
              </Badge>
            </div>
          </div>
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
          {!isLoadingExecutions && !executionsError && executions.length > 0 && filteredExecutions.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              No executions match the current filters.
            </p>
          )}
          {!executionsError && filteredExecutions.map((exec) => (
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
      <div
        className={`w-1 border-r border-gray-700 bg-gray-900/40 hover:bg-indigo-700/40 transition-colors ${isResizing ? 'bg-indigo-700/50' : ''}`}
        role="separator"
        aria-label="Resize execution list panel"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onMouseDown={startResizing}
        onKeyDown={handleResizeKeyDown}
      />

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
                  disabled={copyState.isCopying || hasInvalidBundleDateRange}
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
            <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/60">
              <button
                type="button"
                onClick={() => setShowAdvancedDiagnostics((value) => !value)}
                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-left text-sm text-gray-200 hover:border-indigo-500 hover:text-indigo-200 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-expanded={showAdvancedDiagnostics}
                aria-controls="advanced-diagnostics-panel"
              >
                {showAdvancedDiagnostics ? 'Hide advanced diagnostics' : 'Show advanced diagnostics'}
              </button>
            </div>
            {(logsError || cancelError) && (
              <div className="px-4 py-2 border-b border-gray-800 bg-red-900/20 text-xs text-red-300">
                {cancelError && (
                  <p role="alert">
                    Failed to cancel execution: {cancelError}
                  </p>
                )}
                {logsError && (
                  <div className="mt-1 flex items-center gap-2">
                    <p role="alert">
                      Failed to load logs: {logsError}
                    </p>
                    {selectedExecutionId && (
                      <button
                        type="button"
                        onClick={() => send({ type: 'SELECT_EXECUTION', executionId: selectedExecutionId })}
                        className="px-2 py-0.5 rounded bg-red-800/70 text-red-100 hover:bg-red-700/80 transition-colors"
                      >
                        Reload logs
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
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
            {showAdvancedDiagnostics && (
              <section id="advanced-diagnostics-panel" className="border-b border-gray-800 bg-gray-900/80">
                <div className="px-4 py-3 border-b border-gray-800">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <label className="text-xs text-gray-300">
                      Export Mode
                      <select
                        value={debugBundleExportMode}
                        onChange={(event) => setDebugBundleExportMode(
                          event.target.value as DebugBundleExportMode,
                        )}
                        className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                      >
                        <option value="full">Full bundle</option>
                        <option value="credentialFiltered">Filter credential activity</option>
                      </select>
                    </label>

                    {debugBundleExportMode === 'credentialFiltered' && (
                      <>
                        <label className="text-xs text-gray-300">
                          Provider
                          <select
                            value={bundleCredentialProviderFilter}
                            onChange={(event) => setBundleCredentialProviderFilter(event.target.value)}
                            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                          >
                            <option value="all">All providers</option>
                            <option value="github">GitHub</option>
                            <option value="claude">Claude</option>
                          </select>
                        </label>

                        <label className="text-xs text-gray-300">
                          Action
                          <select
                            value={bundleCredentialActionFilter}
                            onChange={(event) => setBundleCredentialActionFilter(event.target.value)}
                            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                          >
                            <option value="all">All actions</option>
                            <option value="save_token">save_token</option>
                            <option value="delete_token">delete_token</option>
                            <option value="delete_credential">delete_credential</option>
                            <option value="verify_reveal">verify_reveal</option>
                            <option value="save_credential">save_credential</option>
                          </select>
                        </label>

                        <label className="text-xs text-gray-300">
                          Result
                          <select
                            value={bundleCredentialResultFilter}
                            onChange={(event) => setBundleCredentialResultFilter(
                              event.target.value as DebugBundleResultFilter,
                            )}
                            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                          >
                            <option value="all">All results</option>
                            <option value="success">Success</option>
                            <option value="failure">Failure</option>
                          </select>
                        </label>

                        <label className="text-xs text-gray-300">
                          From date
                          <input
                            type="date"
                            value={bundleCredentialFromDate}
                            onChange={(event) => setBundleCredentialFromDate(event.target.value)}
                            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                          />
                        </label>

                        <label className="text-xs text-gray-300">
                          To date
                          <input
                            type="date"
                            value={bundleCredentialToDate}
                            onChange={(event) => setBundleCredentialToDate(event.target.value)}
                            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                          />
                        </label>

                        <label className="text-xs text-gray-300">
                          Max events
                          <input
                            type="number"
                            min={1}
                            max={MAX_DEBUG_BUNDLE_CREDENTIAL_EVENTS}
                            value={bundleCredentialLimit}
                            onChange={(event) => setBundleCredentialLimit(event.target.value)}
                            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                          />
                        </label>
                      </>
                    )}
                  </div>
                  {hasInvalidBundleDateRange && (
                    <p className="mt-2 text-xs text-red-400" role="alert">
                      Credential activity date range is invalid: start date must be before end date.
                    </p>
                  )}
                </div>
                <NodeOutputsPanel contextEntries={contextEntries} />
                <NodeRunInspector contextEntries={contextEntries} />
              </section>
            )}
            <NodeTimelinePanel nodes={timelineNodes} />
            <LogViewer
              logs={allLogs}
              isStreaming={isStreaming}
              densityMode={logDensityMode}
              onDensityModeChange={setLogDensityMode}
            />
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
