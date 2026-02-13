import type { NodeType } from '@/types/workflow';

interface PaletteItem {
  type: NodeType;
  label: string;
  category: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  { type: 'trigger', label: 'Trigger', category: 'Control' },
  { type: 'condition', label: 'Condition', category: 'Control' },
  { type: 'loop', label: 'Loop', category: 'Control' },
  { type: 'delay', label: 'Delay', category: 'Control' },
  { type: 'github.sync', label: 'Sync Repository', category: 'GitHub' },
  { type: 'github.readIssues', label: 'Read Issues', category: 'GitHub' },
  { type: 'github.createPR', label: 'Create PR', category: 'GitHub' },
  { type: 'git.worktree', label: 'Git Worktree', category: 'Git' },
  { type: 'git.branch', label: 'Git Branch', category: 'Git' },
  { type: 'git.commit', label: 'Git Commit', category: 'Git' },
  { type: 'claude.analyze', label: 'Claude Analyze', category: 'Claude' },
  { type: 'claude.plan', label: 'Claude Plan', category: 'Claude' },
  { type: 'claude.apply', label: 'Claude Apply', category: 'Claude' },
];

const CATEGORY_COLORS: Record<string, string> = {
  Control: 'border-blue-500 bg-blue-900/50',
  GitHub: 'border-gray-500 bg-gray-800/50',
  Git: 'border-orange-500 bg-orange-900/50',
  Claude: 'border-purple-500 bg-purple-900/50',
};

interface NodePaletteProps {
  onDragStart: (type: NodeType) => void;
}

export function NodePalette({ onDragStart }: NodePaletteProps) {
  const categories = [...new Set(PALETTE_ITEMS.map((i) => i.category))];

  return (
    <aside
      className="w-56 bg-gray-900 border-r border-gray-700 overflow-y-auto p-3"
      aria-label="Node palette"
    >
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Nodes
      </h2>
      {categories.map((category) => (
        <div key={category} className="mb-4">
          <h3 className="text-xs font-medium text-gray-500 mb-2">{category}</h3>
          <ul className="space-y-1" role="list" aria-label={`${category} nodes`}>
            {PALETTE_ITEMS.filter((i) => i.category === category).map((item) => (
              <li key={item.type}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/workflow-node', item.type);
                    e.dataTransfer.effectAllowed = 'move';
                    onDragStart(item.type);
                  }}
                  className={`
                    w-full text-left px-3 py-2 rounded border text-sm text-white
                    cursor-grab active:cursor-grabbing
                    hover:brightness-125 transition-all
                    ${CATEGORY_COLORS[category]}
                  `}
                  aria-label={`Drag to add ${item.label} node`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}
