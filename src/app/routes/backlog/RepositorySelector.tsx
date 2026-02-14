import type { GitHubRepo } from '@/lib/api/github';

interface RepositorySelectorProps {
  repositories: GitHubRepo[];
  isLoading: boolean;
  selectedOwner: string;
  selectedRepo: string;
  onSelect: (owner: string, repo: string) => void;
}

export function RepositorySelector({
  repositories,
  isLoading,
  selectedOwner,
  selectedRepo,
  onSelect,
}: RepositorySelectorProps) {
  const selectedValue = selectedOwner && selectedRepo
    ? `${selectedOwner}/${selectedRepo}`
    : '';

  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <label
          htmlFor="repo-selector"
          className="block text-sm font-medium text-gray-300"
        >
          Repository
        </label>
        <span className="text-xs text-gray-500">
          {repositories.length} connected repo{repositories.length === 1 ? '' : 's'}
        </span>
      </div>
      <select
        id="repo-selector"
        value={selectedValue}
        onChange={(e) => {
          const val = e.target.value;
          if (val) {
            const [owner, repo] = val.split('/');
            onSelect(owner, repo);
          } else {
            onSelect('', '');
          }
        }}
        disabled={isLoading}
        className="h-10 w-full max-w-md bg-gray-800 border border-gray-700 rounded-lg px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
        aria-label="Select repository"
      >
        <option value="">
          {isLoading ? 'Loading repositories...' : 'Select a repository'}
        </option>
        {repositories.map((repo) => (
          <option key={repo.id} value={`${repo.owner}/${repo.name}`}>
            {repo.full_name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500">
        Choose a repository to sync GitHub issues, triage work, and create linked workflows.
      </p>
    </div>
  );
}
