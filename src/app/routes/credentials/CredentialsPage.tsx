import { CenteredPage, PageHeader } from '@/app/components/PageLayout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge, Button, Input, SectionCard } from '@/components/ui/primitives';
import { useCredentialsModel } from '@/features/credentials/application/use-credentials-model';
import {
  AUDIT_PAGE_SIZE_OPTIONS,
  formatAuditTimestamp,
  toAuditActionLabel,
  type AuditResultFilter,
} from '@/features/credentials/domain/audit';

export function CredentialsPage() {
  const {
    activeTab,
    githubStatus,
    githubStatusError,
    isRefreshingGithub,
    githubToken,
    showGithubToken,
    isGithubTokenAutofillEnabled,
    isSavingGithub,
    githubSaveState,
    isDeletingGithub,
    githubDeleteState,
    showDeleteGitHubDialog,
    showDeleteCredentialDialog,
    selectedCredentialForDelete,
    requiresGithubRevealVerification,
    isVerifyingGithubReveal,
    githubRevealState,
    githubCredentials,
    githubCredentialsError,
    isRefreshingGitHubCredentials,
    credentialSearchQuery,
    claudeStatus,
    claudeStatusError,
    isRefreshingClaude,
    claudeAccountLabel,
    claudeApiKey,
    showClaudeApiKey,
    isSavingClaude,
    claudeSaveState,
    credentialAuditEvents,
    credentialAuditError,
    isRefreshingCredentialAudit,
    auditProviderFilter,
    auditActionFilter,
    auditResultFilter,
    auditFromDate,
    auditToDate,
    auditPageSize,
    auditPage,
    auditProviderOptions,
    auditActionOptions,
    filteredCredentialAuditEvents,
    hasInvalidAuditDateRange,
    totalAuditPages,
    filteredGitHubCredentials,
    hasAuditFilters,
    paginatedCredentialAuditEvents,
    setActiveTab,
    setShowDeleteGitHubDialog,
    setShowDeleteCredentialDialog,
    setSelectedCredentialForDelete,
    setCredentialSearchQuery,
    setClaudeAccountLabel,
    setClaudeApiKey,
    setShowClaudeApiKey,
    setAuditProviderFilter,
    setAuditActionFilter,
    setAuditResultFilter,
    setAuditFromDate,
    setAuditToDate,
    setAuditPage,
    refreshGitHubStatus,
    refreshCredentialAudit,
    refreshGitHubCredentials,
    refreshClaudeStatus,
    handleGitHubSubmit,
    handleGitHubTokenChange,
    handleGitHubTokenVisibilityToggle,
    handleGitHubTokenAutofillToggle,
    confirmDeleteGitHubToken,
    requestDeleteGitHubCredential,
    confirmDeleteGitHubCredential,
    handleClaudeSubmit,
    resetAuditFilters,
    handleAuditPageSizeChange,
    exportFilteredCredentialAudit,
  } = useCredentialsModel();
  return (
    <CenteredPage width="md">
      <PageHeader
        title="Credentials"
        description="Manage encrypted credentials stored in your local database"
        metadata={(
          <div className="flex flex-wrap gap-2">
            <Badge tone={githubStatus?.authenticated ? 'success' : 'warning'}>
              GitHub {githubStatus?.authenticated ? 'Connected' : 'Not connected'}
            </Badge>
            <Badge tone={claudeStatus?.configured ? 'success' : 'warning'}>
              Claude {claudeStatus?.configured ? 'Configured' : 'Not configured'}
            </Badge>
            <Badge tone="info">
              Activity events {credentialAuditEvents.length}
            </Badge>
          </div>
        )}
      />

      <div className="mb-6">
        <div
          className="inline-flex rounded-lg border border-gray-700 bg-gray-900/70 p-1"
          role="tablist"
          aria-label="Credentials sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'github'}
            onClick={() => setActiveTab('github')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'github'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            GitHub
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'activity'}
            onClick={() => setActiveTab('activity')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'activity'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            Activity
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'claude'}
            onClick={() => setActiveTab('claude')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'claude'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            Claude
          </button>
        </div>
      </div>

      {activeTab === 'github' && (
      <SectionCard className="mb-6" aria-labelledby="github-credentials-heading">
        <h2 id="github-credentials-heading" className="text-lg font-semibold text-white mb-4">
          GitHub Account
        </h2>

        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm text-gray-300">Status:</span>
            {isRefreshingGithub ? (
              <span className="text-sm text-gray-400">Checking...</span>
            ) : githubStatus?.authenticated ? (
              <span className="text-sm text-green-400">Connected as {githubStatus.username}</span>
            ) : githubStatusError ? (
              <span className="text-sm text-red-400">Could not verify authentication status</span>
            ) : (
              <span className="text-sm text-yellow-300">Not authenticated</span>
            )}
          </div>

          {githubStatusError ? (
            <Button
              onClick={() => void refreshGitHubStatus()}
              disabled={isRefreshingGithub}
              variant="danger"
              size="sm"
              className="bg-red-800/70 hover:bg-red-700/80"
            >
              {isRefreshingGithub ? 'Retrying...' : 'Retry status check'}
            </Button>
          ) : null}
        </div>

        <form onSubmit={(event) => void handleGitHubSubmit(event)} className="space-y-4">
          <div>
            <label
              htmlFor="github-token"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Personal Access Token
            </label>
            <div className="relative">
              <input
                id="github-token"
                type={showGithubToken ? 'text' : 'password'}
                value={githubToken}
                onChange={(event) => handleGitHubTokenChange(event.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white font-mono pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-describedby="github-token-help"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => void handleGitHubTokenVisibilityToggle()}
                disabled={!githubToken.trim() || isVerifyingGithubReveal}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
                aria-label={
                  showGithubToken
                    ? 'Hide token'
                    : requiresGithubRevealVerification
                      ? 'Verify and show token'
                      : 'Show token'
                }
                aria-pressed={showGithubToken}
              >
                {showGithubToken
                  ? 'Hide'
                  : isVerifyingGithubReveal
                    ? 'Verifying...'
                    : requiresGithubRevealVerification
                      ? 'Verify & Show'
                      : 'Show'}
              </button>
            </div>
            <p id="github-token-help" className="text-xs text-gray-400 mt-1">
              Required scopes: repo, workflow.
            </p>
            {githubRevealState === 'success' ? (
              <p className="text-xs text-green-400 mt-1" role="status" aria-live="polite">
                Token verification succeeded.
              </p>
            ) : null}
            {githubRevealState === 'error' ? (
              <p className="text-xs text-red-400 mt-1" role="alert">
                Token verification failed. Save a valid token and retry.
              </p>
            ) : null}
            <label className="inline-flex items-center gap-2 text-xs text-gray-300 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isGithubTokenAutofillEnabled}
                onChange={(event) => handleGitHubTokenAutofillToggle(event.target.checked)}
                className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-indigo-600 focus:ring-indigo-500"
              />
              Auto-fill saved token on page open
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={!githubToken.trim() || isSavingGithub}
            >
              {isSavingGithub ? 'Saving...' : 'Save GitHub Token'}
            </Button>
            <Button
              onClick={() => setShowDeleteGitHubDialog(true)}
              disabled={isDeletingGithub}
              variant="secondary"
            >
              {isDeletingGithub ? 'Removing...' : 'Remove Saved Token'}
            </Button>

            {githubSaveState === 'success' ? (
              <span className="text-sm text-green-400" role="status" aria-live="polite">
                GitHub token saved
              </span>
            ) : null}
            {githubSaveState === 'error' ? (
              <span className="text-sm text-red-400" role="alert">
                Failed to save GitHub token
              </span>
            ) : null}
            {githubDeleteState === 'success' ? (
              <span className="text-sm text-green-400" role="status" aria-live="polite">
                GitHub credential removed
              </span>
            ) : null}
            {githubDeleteState === 'error' ? (
              <span className="text-sm text-red-400" role="alert">
                Failed to remove GitHub credential
              </span>
            ) : null}
          </div>
        </form>

        <div className="mt-6 border-t border-gray-700 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-200">Saved Credential Profiles</h3>
            <Button
              onClick={() => void refreshGitHubCredentials()}
              disabled={isRefreshingGitHubCredentials}
              variant="secondary"
              size="sm"
            >
              {isRefreshingGitHubCredentials ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
          <Input
            type="search"
            value={credentialSearchQuery}
            onChange={(event) => setCredentialSearchQuery(event.target.value)}
            placeholder="Search credentials by label, username, or ID"
            className="mb-3 h-9 text-sm bg-gray-900 border-gray-700"
            aria-label="Search saved GitHub credentials"
          />

          {githubCredentialsError ? (
            <p className="text-sm text-red-400">Could not load saved GitHub credentials.</p>
          ) : githubCredentials.length === 0 ? (
            <p className="text-sm text-gray-400">No saved GitHub credentials.</p>
          ) : filteredGitHubCredentials.length === 0 ? (
            <p className="text-sm text-gray-400">No credential profiles match your search.</p>
          ) : (
            <ul className="space-y-2" aria-label="Saved GitHub credentials">
              {filteredGitHubCredentials.map((credential) => (
                <li key={credential.id} className="flex items-center justify-between gap-3 rounded border border-gray-700 bg-gray-900/40 px-3 py-2">
                  <div>
                    <p className="text-sm text-gray-100">
                      {credential.label}
                      {credential.is_default ? ' (Default)' : ''}
                    </p>
                    <p className="text-xs text-gray-500 font-mono">{credential.id}</p>
                  </div>
                  <Button
                    onClick={() => requestDeleteGitHubCredential(credential)}
                    disabled={isDeletingGithub || credential.id === '__active_session__'}
                    variant="secondary"
                    size="sm"
                  >
                    Remove Profile
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>
      )}

      {activeTab === 'activity' && (
      <SectionCard className="mb-6" aria-labelledby="credential-audit-heading">
        <div className="sticky top-0 z-20 -mx-6 mb-4 border-b border-gray-700 bg-gray-800/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 id="credential-audit-heading" className="text-lg font-semibold text-white">
              Credential Activity
            </h2>
            <div className="flex items-center gap-2">
              {hasAuditFilters ? (
                <Button
                  onClick={resetAuditFilters}
                  variant="ghost"
                  size="sm"
                >
                  Reset filters
                </Button>
              ) : null}
              <Button
                onClick={exportFilteredCredentialAudit}
                disabled={filteredCredentialAuditEvents.length === 0 || hasInvalidAuditDateRange}
                variant="secondary"
                size="sm"
              >
                Export JSON
              </Button>
              <Button
                onClick={() => void refreshCredentialAudit()}
                disabled={isRefreshingCredentialAudit}
                variant="secondary"
                size="sm"
              >
                {isRefreshingCredentialAudit ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
          </div>
          {!credentialAuditError && credentialAuditEvents.length > 0 && (
            <p className="mt-2 text-xs text-gray-400">Filters stay pinned while you scroll activity events.</p>
          )}
        </div>

        {credentialAuditError ? (
          <p className="text-sm text-red-400">Could not load credential activity.</p>
        ) : credentialAuditEvents.length === 0 ? (
          <p className="text-sm text-gray-400">No credential activity yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
              <label className="text-xs text-gray-300">
                Provider
                <select
                  value={auditProviderFilter}
                  onChange={(event) => setAuditProviderFilter(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                >
                  <option value="all">All providers</option>
                  {auditProviderOptions.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-gray-300">
                Action
                <select
                  value={auditActionFilter}
                  onChange={(event) => setAuditActionFilter(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                >
                  <option value="all">All actions</option>
                  {auditActionOptions.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-gray-300">
                Result
                <select
                  value={auditResultFilter}
                  onChange={(event) => setAuditResultFilter(event.target.value as AuditResultFilter)}
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
                  value={auditFromDate}
                  onChange={(event) => setAuditFromDate(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                />
              </label>

              <label className="text-xs text-gray-300">
                To date
                <input
                  type="date"
                  value={auditToDate}
                  onChange={(event) => setAuditToDate(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                />
              </label>

              <label className="text-xs text-gray-300">
                Page size
                <select
                  value={String(auditPageSize)}
                  onChange={(event) => handleAuditPageSizeChange(Number(event.target.value))}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                >
                  {AUDIT_PAGE_SIZE_OPTIONS.map((pageSize) => (
                    <option key={pageSize} value={pageSize}>
                      {pageSize} events
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {hasInvalidAuditDateRange ? (
              <p className="text-sm text-red-400 mb-3">
                Date range is invalid. Choose a start date before the end date.
              </p>
            ) : null}

            {filteredCredentialAuditEvents.length === 0 ? (
              <p className="text-sm text-gray-400">No activity matches the current filters.</p>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-2">
                  Showing {(auditPage - 1) * auditPageSize + 1}-
                  {Math.min(auditPage * auditPageSize, filteredCredentialAuditEvents.length)} of{' '}
                  {filteredCredentialAuditEvents.length} matching events.
                </p>
                <ul className="space-y-2" aria-label="Credential activity log">
                  {paginatedCredentialAuditEvents.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 text-sm border-b border-gray-700/70 pb-2">
                    <div>
                      <p className={event.success ? 'text-green-300' : 'text-red-300'}>
                        {event.provider.toUpperCase()}: {toAuditActionLabel(event)}
                      </p>
                      {event.detail ? <p className="text-xs text-gray-400">{event.detail}</p> : null}
                    </div>
                    <time className="text-xs text-gray-500">{formatAuditTimestamp(event.timestamp)}</time>
                  </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center justify-between">
                  <Button
                    onClick={() => setAuditPage((currentPage) => Math.max(1, currentPage - 1))}
                    disabled={auditPage <= 1}
                    variant="secondary"
                    size="sm"
                  >
                    Previous
                  </Button>
                  <p className="text-xs text-gray-400">
                    Page {auditPage} of {totalAuditPages}
                  </p>
                  <Button
                    onClick={() => setAuditPage((currentPage) => Math.min(totalAuditPages, currentPage + 1))}
                    disabled={auditPage >= totalAuditPages}
                    variant="secondary"
                    size="sm"
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </SectionCard>
      )}

      {activeTab === 'claude' && (
      <SectionCard aria-labelledby="claude-credentials-heading">
        <h2 id="claude-credentials-heading" className="text-lg font-semibold text-white mb-4">
          Claude Account
        </h2>

        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-gray-300">Status:</span>
            {isRefreshingClaude ? (
              <span className="text-sm text-gray-400">Checking...</span>
            ) : claudeStatus?.configured ? (
              <span className="text-sm text-green-400">Configured</span>
            ) : claudeStatusError ? (
              <span className="text-sm text-red-400">Could not verify credential status</span>
            ) : (
              <span className="text-sm text-yellow-300">Not configured</span>
            )}
          </div>
          {claudeStatus?.account_label ? (
            <p className="text-xs text-gray-400">Account: {claudeStatus.account_label}</p>
          ) : null}
          {claudeStatusError ? (
            <Button
              onClick={() => void refreshClaudeStatus()}
              disabled={isRefreshingClaude}
              variant="danger"
              size="sm"
              className="mt-2 bg-red-800/70 hover:bg-red-700/80"
            >
              {isRefreshingClaude ? 'Retrying...' : 'Retry status check'}
            </Button>
          ) : null}
        </div>

        <form onSubmit={(event) => void handleClaudeSubmit(event)} className="space-y-4">
          <div>
            <label
              htmlFor="claude-account-label"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Account Label (optional)
            </label>
            <input
              id="claude-account-label"
              type="text"
              value={claudeAccountLabel}
              onChange={(event) => setClaudeAccountLabel(event.target.value)}
              placeholder="work-account"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoComplete="off"
            />
          </div>

          <div>
            <label
              htmlFor="claude-api-key"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              API Key
            </label>
            <div className="relative">
              <input
                id="claude-api-key"
                type={showClaudeApiKey ? 'text' : 'password'}
                value={claudeApiKey}
                onChange={(event) => setClaudeApiKey(event.target.value)}
                placeholder="sk-ant-..."
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white font-mono pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowClaudeApiKey((current) => !current)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
                aria-label={showClaudeApiKey ? 'Hide API key' : 'Show API key'}
                aria-pressed={showClaudeApiKey}
              >
                {showClaudeApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={!claudeApiKey.trim() || isSavingClaude}
            >
              {isSavingClaude ? 'Saving...' : 'Save Claude Credentials'}
            </Button>

            {claudeSaveState === 'success' ? (
              <span className="text-sm text-green-400" role="status" aria-live="polite">
                Claude credentials saved
              </span>
            ) : null}
            {claudeSaveState === 'error' ? (
              <span className="text-sm text-red-400" role="alert">
                Failed to save Claude credentials
              </span>
            ) : null}
          </div>
        </form>
      </SectionCard>
      )}

      <ConfirmDialog
        open={showDeleteGitHubDialog}
        title="Remove Saved GitHub Token"
        message="This removes all saved GitHub credential entries from local storage. Continue?"
        confirmLabel={isDeletingGithub ? 'Removing...' : 'Remove Token'}
        cancelLabel="Cancel"
        confirmDisabled={isDeletingGithub}
        onConfirm={() => void confirmDeleteGitHubToken()}
        onCancel={() => {
          if (!isDeletingGithub) setShowDeleteGitHubDialog(false);
        }}
      />
      <ConfirmDialog
        open={showDeleteCredentialDialog}
        title="Remove GitHub Credential Profile"
        message={`Remove credential profile "${selectedCredentialForDelete?.label ?? ''}" from local storage?`}
        confirmLabel={isDeletingGithub ? 'Removing...' : 'Remove Profile'}
        cancelLabel="Cancel"
        confirmDisabled={isDeletingGithub}
        onConfirm={() => void confirmDeleteGitHubCredential()}
        onCancel={() => {
          if (!isDeletingGithub) {
            setShowDeleteCredentialDialog(false);
            setSelectedCredentialForDelete(null);
          }
        }}
      />
    </CenteredPage>
  );
}
