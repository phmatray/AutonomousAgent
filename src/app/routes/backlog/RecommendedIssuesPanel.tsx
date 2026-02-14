import type { BacklogItem } from '@/types/workflow';
import type { BacklogRecommendation } from '@/features/backlog/domain/recommendations';
import { Button } from '@/components/ui/primitives';

interface RecommendedIssuesPanelProps {
  recommendations: BacklogRecommendation[];
  onViewDetails: (itemId: string) => void;
  onStartAutomation: (item: BacklogItem) => void;
  isStartingAutomation: boolean;
}

export function RecommendedIssuesPanel({
  recommendations,
  onViewDetails,
  onStartAutomation,
  isStartingAutomation,
}: RecommendedIssuesPanelProps) {
  if (recommendations.length === 0) {
    return (
      <section className="mb-4 rounded-lg border border-dashed border-gray-700 bg-gray-900/50 p-4">
        <h2 className="text-sm font-semibold text-white">Recommended Issues</h2>
        <p className="mt-2 text-sm text-gray-400">
          No automation-ready issues yet. Sync backlog data, mark items as ready, and set priority/impact signals to unlock recommendations.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-lg border border-indigo-800/60 bg-indigo-950/20 p-4" aria-label="Recommended issues for automation">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-indigo-100">Recommended Issues</h2>
        <p className="text-xs text-indigo-200/80">Ranked by triage, priority, readiness, and impact</p>
      </div>
      <div className="grid gap-3">
        {recommendations.map(({ item, score, rationale }) => (
          <article
            key={item.id}
            className="rounded-md border border-indigo-700/40 bg-gray-900/80 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-mono text-indigo-200/80">#{item.issue_number} · score {score}</p>
                <p className="mt-1 text-sm font-medium text-white">{item.title}</p>
                <p className="mt-1 text-xs text-gray-400">{item.owner}/{item.repo}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => onViewDetails(item.id)}
                >
                  Why this issue
                </Button>
                <Button
                  onClick={() => onStartAutomation(item)}
                  disabled={isStartingAutomation}
                >
                  {isStartingAutomation ? 'Starting...' : 'Automate Issue'}
                </Button>
              </div>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-indigo-100/90">
              {rationale.map((reason) => (
                <li key={reason}>- {reason}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
