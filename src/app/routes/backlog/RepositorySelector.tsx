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
      <label
        htmlFor="repo-selector"
        className="block text-sm font-medium text-gray-300 mb-1"
      >
        Repository
      </label>
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
    </div>
  );
}
