import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import type { DebugBundleCredentialAuditFilter } from '@/lib/api/workflow';
import { monitoringMachine } from '@/app/routes/monitoring/monitoring-machine';
import {
  onExecutionLogStream,
  onWorkflowExecutionStatus,
  onWorkflowNodeFinished,
  onWorkflowNodeStarted,
} from '@/lib/events/workflow-events';
import type {
  ExecutionStatus,
  RuntimeNodeEvent,
} from '@/types/workflow';
import {
  clampSidebarWidth,
  countExecutionsByStatus,
  filterExecutions,
  formatExportError,
  getExecutionContextEntries,
  loadLogDensityMode,
  loadSidebarWidth,
  LOG_DENSITY_STORAGE_KEY,
  MAX_DEBUG_BUNDLE_CREDENTIAL_EVENTS,
  SIDEBAR_WIDTH_STORAGE_KEY,
  toDateBoundaryIso,
  toTimelineState,
  upsertTimelineNode,
  type LogDensityMode,
  type TimelineNodeState,
} from '@/features/monitoring/domain/monitoring';
import { exportDebugBundle } from '@/features/monitoring/application/debug-bundle';

export type DebugBundleExportMode = 'full' | 'credentialFiltered';
export type DebugBundleResultFilter = 'all' | 'success' | 'failure';

interface UseMonitoringModelParams {
  requestedExecutionId: string | null;
}

export function useMonitoringModel({ requestedExecutionId }: UseMonitoringModelParams) {
  const [state, send] = useMachine(monitoringMachine);
  const containerRef = useRef<HTMLDivElement>(null);
  const executions = state.context.executions;
  const selectedExecutionId = state.context.selectedExecutionId;
  const logs = state.context.logs;
  const streamingLogs = state.context.streamingLogs;
  const executionsError = state.context.executionsError;
  const logsError = state.context.logsError;
  const cancelError = state.context.cancelError;
  const isLoadingExecutions = state.matches('loadingExecutions');
  const isFetchingExecutions = state.matches('refreshingExecutions');
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [logDensityMode, setLogDensityMode] = useState<LogDensityMode>(loadLogDensityMode);
  const [executionSearchQuery, setExecutionSearchQuery] = useState('');
  const [executionStatusFilter, setExecutionStatusFilter] = useState<'ALL' | ExecutionStatus>('ALL');
  const [isResizing, setIsResizing] = useState(false);
  const [timelineNodes, setTimelineNodes] = useState<TimelineNodeState[]>([]);
  const [showAdvancedDiagnostics, setShowAdvancedDiagnostics] = useState(false);

  useEffect(() => {
    send({ type: 'REQUESTED_EXECUTION_CHANGED', executionId: requestedExecutionId });
  }, [requestedExecutionId, send]);

  useEffect(() => {
    let unlisten = () => {};
    if (selectedExecutionId) {
      onExecutionLogStream(selectedExecutionId, (payload) => {
        send({ type: 'STREAM_LOG_RECEIVED', log: payload });
      }).then((fn) => {
        unlisten = fn;
      });
    }
    return () => {
      unlisten();
    };
  }, [selectedExecutionId, send]);

  useEffect(() => {
    let unlisten = () => {};
    onWorkflowExecutionStatus((payload) => {
      send({ type: 'EXECUTION_STATUS_RECEIVED', execution: payload });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten();
    };
  }, [send]);

  useEffect(() => {
    const selectedId = selectedExecutionId;
    let unlistenStarted = () => {};
    let unlistenFinished = () => {};

    const upsertFromEvent = (event: RuntimeNodeEvent) => {
      if (!selectedId || event.executionId !== selectedId) return;
      setTimelineNodes((current) => upsertTimelineNode(current, {
        executionId: event.executionId,
        workflowId: event.workflowId,
        nodeId: event.nodeId,
        nodeType: event.nodeType,
        status: event.status,
        startedAt: event.startedAt,
        completedAt: event.completedAt ?? null,
        durationMs: event.durationMs ?? null,
        retryCount: event.retryCount ?? null,
        error: event.error ?? null,
      }));
    };

    onWorkflowNodeStarted((payload) => {
      upsertFromEvent(payload);
    }).then((fn) => {
      unlistenStarted = fn;
    });

    onWorkflowNodeFinished((payload) => {
      upsertFromEvent(payload);
    }).then((fn) => {
      unlistenFinished = fn;
    });

    return () => {
      unlistenStarted();
      unlistenFinished();
    };
  }, [selectedExecutionId]);

  const allLogs = [...logs, ...streamingLogs];
  const selectedExecution = executions.find((execution) => execution.id === selectedExecutionId);
  const isStreaming = selectedExecution?.status === 'RUNNING';
  const executionStatusCounts = useMemo(
    () => countExecutionsByStatus(executions),
    [executions],
  );
  const filteredExecutions = useMemo(
    () => filterExecutions(executions, executionSearchQuery, executionStatusFilter),
    [executionSearchQuery, executionStatusFilter, executions],
  );
  const contextEntries = useMemo(
    () => getExecutionContextEntries(selectedExecution?.context),
    [selectedExecution?.context],
  );

  useEffect(() => {
    if (!selectedExecutionId) {
      setTimelineNodes([]);
      return;
    }
    const contextTimeline = contextEntries.map((entry) => ({
      ...toTimelineState(entry),
      executionId: selectedExecutionId,
      workflowId: selectedExecution?.workflowId ?? '',
    }));
    setTimelineNodes(contextTimeline);
  }, [contextEntries, selectedExecution?.workflowId, selectedExecutionId]);

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
  const [debugBundleExportMode, setDebugBundleExportMode] =
    useState<DebugBundleExportMode>('full');
  const [bundleCredentialProviderFilter, setBundleCredentialProviderFilter] = useState('all');
  const [bundleCredentialActionFilter, setBundleCredentialActionFilter] = useState('all');
  const [bundleCredentialResultFilter, setBundleCredentialResultFilter] =
    useState<DebugBundleResultFilter>('all');
  const [bundleCredentialFromDate, setBundleCredentialFromDate] = useState('');
  const [bundleCredentialToDate, setBundleCredentialToDate] = useState('');
  const [bundleCredentialLimit, setBundleCredentialLimit] = useState('100');

  const bundleFromTimestamp = toDateBoundaryIso(bundleCredentialFromDate, false);
  const bundleToTimestamp = toDateBoundaryIso(bundleCredentialToDate, true);
  const hasInvalidBundleDateRange = Boolean(
    bundleFromTimestamp
      && bundleToTimestamp
      && new Date(bundleFromTimestamp).getTime() > new Date(bundleToTimestamp).getTime(),
  );

  const handleCopyDebugBundle = async () => {
    if (!selectedExecutionId || copyState.isCopying || hasInvalidBundleDateRange) return;

    let credentialAuditFilter: DebugBundleCredentialAuditFilter | undefined;
    if (debugBundleExportMode === 'credentialFiltered') {
      const parsedLimit = Number.parseInt(bundleCredentialLimit, 10);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(MAX_DEBUG_BUNDLE_CREDENTIAL_EVENTS, Math.max(1, parsedLimit))
        : 100;

      credentialAuditFilter = {
        provider: bundleCredentialProviderFilter !== 'all'
          ? bundleCredentialProviderFilter
          : undefined,
        action: bundleCredentialActionFilter !== 'all'
          ? bundleCredentialActionFilter
          : undefined,
        result: bundleCredentialResultFilter,
        fromTimestamp: bundleFromTimestamp ?? undefined,
        toTimestamp: bundleToTimestamp ?? undefined,
        limit,
      };
    }

    setCopyState({ isCopying: true, copied: 'none', error: null });
    try {
      const mode = await exportDebugBundle(selectedExecutionId, credentialAuditFilter);
      if (mode === 'clipboard') {
        setCopyState({ isCopying: false, copied: 'clipboard', error: null });
      } else {
        setCopyState({ isCopying: false, copied: 'download', error: null });
      }
    } catch (error) {
      const message = formatExportError(error);
      setCopyState({ isCopying: false, copied: 'none', error: message });
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LOG_DENSITY_STORAGE_KEY, logDensityMode);
  }, [logDensityMode]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const nextWidth = clampSidebarWidth(event.clientX - containerRect.left);
      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const startResizing = () => {
    setIsResizing(true);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -16 : 16;
    setSidebarWidth((currentWidth) => clampSidebarWidth(currentWidth + delta));
  };

  return {
    containerRef,
    send,
    executions,
    selectedExecutionId,
    logs,
    streamingLogs,
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
  };
}
