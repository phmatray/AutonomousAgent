import { Input } from '@/components/ui/primitives';

interface BacklogFiltersProps {
  stateFilter: string;
  onStateFilterChange: (value: string) => void;
  labelFilter: string;
  onLabelFilterChange: (value: string) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  availableLabels: string[];
}

export function BacklogFilters({
  stateFilter,
  onStateFilterChange,
  labelFilter,
  onLabelFilterChange,
  searchQuery,
  onSearchQueryChange,
  availableLabels,
}: BacklogFiltersProps) {
  return (
    <div className="sticky top-0 z-20 mb-4 rounded-lg border border-gray-700 bg-gray-900/90 backdrop-blur px-3 py-3">
      <p className="text-xs text-gray-400 mb-2">Filter backlog</p>
      <div className="flex flex-wrap items-center gap-3">
      <div>
        <label htmlFor="state-filter" className="sr-only">
          Filter by state
        </label>
        <select
          id="state-filter"
          value={stateFilter}
          onChange={(e) => onStateFilterChange(e.target.value)}
          className="h-10 bg-gray-800 border border-gray-700 rounded-lg px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="Filter by issue state"
        >
          <option value="">All states</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div>
        <label htmlFor="label-filter" className="sr-only">
          Filter by label
        </label>
        <select
          id="label-filter"
          value={labelFilter}
          onChange={(e) => onLabelFilterChange(e.target.value)}
          className="h-10 bg-gray-800 border border-gray-700 rounded-lg px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="Filter by label"
        >
          <option value="">All labels</option>
          {availableLabels.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-w-[200px]">
        <label htmlFor="search-query" className="sr-only">
          Search issues
        </label>
        <Input
          id="search-query"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search issues..."
          className="h-10 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 text-sm text-white placeholder-gray-500"
          aria-label="Search issues by title or body"
        />
      </div>
      </div>
    </div>
  );
}
