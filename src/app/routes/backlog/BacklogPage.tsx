import {
  BacklogPriority,
  BacklogTriageStatus,
} from '@/types/workflow';
import { BacklogHeader } from './BacklogHeader';
import { RepositorySelector } from './RepositorySelector';
import { BacklogFilters } from './BacklogFilters';
import { BacklogTable } from './BacklogTable';
import { BacklogDetailsPanel } from './BacklogDetailsPanel';
import { RecommendedIssuesPanel } from './RecommendedIssuesPanel';
import { useRouter } from '@/lib/router';
import {
  CenteredPage,
  PageEmptyState,
  PageLoadingState,
  PageNotice,
} from '@/app/components/PageLayout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/primitives';
import {
  SAVED_VIEW_OPTIONS,
} from '@/features/backlog/domain/views';
import { useBacklogModel } from '@/features/backlog/application/use-backlog-model';

export function BacklogPage() {
  const { params, navigate } = useRouter();
  const {
    repositories,
    reposLoading,
    backlogLoading,
    selectedOwner,
    selectedRepo,
    savedView,
    stateFilter,
    triageFilter,
    priorityFilter,
    labelFilter,
    searchQuery,
    selectedIds,
    bulkTriageStatus,
    bulkPriority,
    linkedWorkflowFeedback,
    selectedItemId,
    viewItems,
    selectedItem,
    availableLabels,
    recommendedItems,
    savedViewCounts,
    pendingDeleteItem,
    repositoryLabel,
    hasActiveBacklogFilters,
    syncMutation,
    deleteMutation,
    updateTriageMutation,
    bulkUpdateMutation,
    createWorkflowMutation,
    setSavedView,
    setStateFilter,
    setTriageFilter,
    setPriorityFilter,
    setLabelFilter,
    setSearchQuery,
    setBulkTriageStatus,
    setBulkPriority,
    setSelectedIds,
    handleRepoSelect,
    openDetails,
    closeDetails,
    requestDelete,
    cancelDelete,
    confirmDelete,
    openWorkflow,
    startAutomationFromRecommendation,
    toggleSelectedId,
    toggleSelectAll,
    applyBulkUpdate,
    archiveSelected,
    linkSelected,
    clearFilters,
  } = useBacklogModel({ params, navigate });

  return (
    <CenteredPage width="xl">
      <BacklogHeader
        itemCount={viewItems.length}
        selectedCount={selectedIds.length}
        repositoryLabel={repositoryLabel}
        isSyncing={syncMutation.isPending}
        onSync={() => syncMutation.mutate()}
        syncDisabled={!selectedOwner || !selectedRepo}
      />

      <RepositorySelector
        repositories={repositories}
        isLoading={reposLoading}
        selectedOwner={selectedOwner}
        selectedRepo={selectedRepo}
        onSelect={handleRepoSelect}
      />

      {(selectedOwner && selectedRepo) && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {SAVED_VIEW_OPTIONS.map(([view, label]) => (
              <button
                key={view}
                type="button"
                onClick={() => setSavedView(view)}
                className={`rounded border px-3 py-1.5 text-xs ${savedView === view
                  ? 'border-indigo-500 bg-indigo-900/30 text-indigo-200'
                  : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600'
                }`}
              >
                {label} ({savedViewCounts[view]})
              </button>
            ))}
          </div>

          <BacklogFilters
            stateFilter={stateFilter}
            onStateFilterChange={setStateFilter}
            triageFilter={triageFilter}
            onTriageFilterChange={setTriageFilter}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            labelFilter={labelFilter}
            onLabelFilterChange={setLabelFilter}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            availableLabels={availableLabels}
            onClearFilters={clearFilters}
          />

          <RecommendedIssuesPanel
            recommendations={recommendedItems.slice(0, 5)}
            onViewDetails={openDetails}
            onStartAutomation={startAutomationFromRecommendation}
            isStartingAutomation={createWorkflowMutation.isPending}
          />

          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2">
            <span className="text-xs text-gray-400">Bulk actions ({selectedIds.length})</span>
            <select
              value={bulkTriageStatus}
              onChange={(event) => setBulkTriageStatus(event.target.value as '' | BacklogTriageStatus)}
              className="h-8 rounded border border-gray-700 bg-gray-800 px-2 text-xs text-white"
            >
              <option value="">Set triage...</option>
              <option value="inbox">Inbox</option>
              <option value="ready">Ready</option>
              <option value="in_progress">In Progress</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </select>
            <select
              value={bulkPriority}
              onChange={(event) => setBulkPriority(event.target.value as '' | BacklogPriority)}
              className="h-8 rounded border border-gray-700 bg-gray-800 px-2 text-xs text-white"
            >
              <option value="">Set priority...</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <Button
              onClick={applyBulkUpdate}
              disabled={selectedIds.length === 0 || bulkUpdateMutation.isPending}
              variant="secondary"
            >
              Apply
            </Button>
            <Button
              onClick={linkSelected}
              disabled={selectedIds.length === 0 || createWorkflowMutation.isPending}
              variant="secondary"
            >
              Auto-link Workflows
            </Button>
            <Button
              onClick={archiveSelected}
              disabled={selectedIds.length === 0 || bulkUpdateMutation.isPending}
              variant="secondary"
              className="text-red-300 border-red-800/70"
            >
              Archive Selected
            </Button>
            <Button
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0}
              variant="ghost"
              size="sm"
            >
              Clear Selection
            </Button>
            <span className="text-xs text-gray-500 ml-auto">Shortcuts: j/k move, e open, l link</span>
          </div>
        </>
      )}
      {!selectedOwner || !selectedRepo ? (
        <PageNotice tone="info" title="Select a repository">
          Choose a repository before syncing issues or running targeted backlog actions.
        </PageNotice>
      ) : null}
      {linkedWorkflowFeedback ? (
        <PageNotice tone="success" title="Workflow link update">
          {linkedWorkflowFeedback}
        </PageNotice>
      ) : null}

      {syncMutation.isError && (
        <PageNotice tone="danger" title="Issue sync failed">
          Failed to sync issues: {String(syncMutation.error)}
        </PageNotice>
      )}

      {backlogLoading ? (
        <PageLoadingState label="Loading backlog" />
      ) : viewItems.length === 0 ? (
        <PageEmptyState
          title="No backlog items in this view"
          description={
            hasActiveBacklogFilters
              ? 'Try resetting filters or selecting a different saved view.'
              : 'Sync repository issues from GitHub to start triaging work.'
          }
          actions={hasActiveBacklogFilters ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={clearFilters}
            >
              Reset Filters
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden flex-1 min-w-0">
            <BacklogTable
              items={viewItems}
              selectedItemId={selectedItemId}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelectedId}
              onToggleSelectAll={toggleSelectAll}
              onViewDetails={openDetails}
              onRequestDelete={requestDelete}
              onUpdateTriage={(backlogItemId, patch) => {
                updateTriageMutation.mutate({ backlogItemId, patch });
              }}
              isDeleting={deleteMutation.isPending}
              isUpdatingTriage={updateTriageMutation.isPending || bulkUpdateMutation.isPending}
            />
          </div>
          {selectedItem && (
            <BacklogDetailsPanel
              item={selectedItem}
              onClose={closeDetails}
              onCreateLinkedWorkflow={(backlogItemId) => createWorkflowMutation.mutate(backlogItemId)}
              onOpenLinkedWorkflow={openWorkflow}
              onUpdateTriage={(backlogItemId, patch) => {
                updateTriageMutation.mutate({ backlogItemId, patch });
              }}
              isCreatingLinkedWorkflow={createWorkflowMutation.isPending}
              isUpdatingTriage={updateTriageMutation.isPending || bulkUpdateMutation.isPending}
              createLinkedWorkflowError={
                createWorkflowMutation.isError ? String(createWorkflowMutation.error) : null
              }
              linkedWorkflowFeedback={linkedWorkflowFeedback}
            />
          )}
        </div>
      )}
      <ConfirmDialog
        open={pendingDeleteItem !== null}
        title="Remove Backlog Item"
        message={
          pendingDeleteItem
            ? `Remove issue #${pendingDeleteItem.issue_number} from backlog? This does not delete the issue on GitHub.`
            : ''
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        confirmDisabled={deleteMutation.isPending}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </CenteredPage>
  );
}
