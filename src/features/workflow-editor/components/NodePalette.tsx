import type { LucideIcon } from 'lucide-react';
import {
  Zap,
  GitFork,
  Repeat,
  Timer,
  RefreshCw,
  BookOpen,
  GitPullRequest,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  Search,
  FileText,
  Play,
} from 'lucide-react';
import type { NodeType } from '@/types/workflow';

type Category = 'control' | 'github' | 'git' | 'claude';

interface PaletteItem {
  type: NodeType;
  label: string;
  category: Category;
  icon: LucideIcon;
}

const PALETTE_ITEMS: PaletteItem[] = [
  { type: 'trigger', label: 'Trigger', category: 'control', icon: Zap },
  { type: 'condition', label: 'Condition', category: 'control', icon: GitFork },
  { type: 'loop', label: 'Loop', category: 'control', icon: Repeat },
  { type: 'delay', label: 'Delay', category: 'control', icon: Timer },
  { type: 'github.sync', label: 'Sync Repository', category: 'github', icon: RefreshCw },
  { type: 'github.readIssues', label: 'Read Issues', category: 'github', icon: BookOpen },
  { type: 'github.createPR', label: 'Create PR', category: 'github', icon: GitPullRequest },
  { type: 'git.worktree', label: 'Git Worktree', category: 'git', icon: FolderTree },
  { type: 'git.branch', label: 'Git Branch', category: 'git', icon: GitBranch },
  { type: 'git.commit', label: 'Git Commit', category: 'git', icon: GitCommitHorizontal },
  { type: 'claude.analyze', label: 'Claude Analyze', category: 'claude', icon: Search },
  { type: 'claude.plan', label: 'Claude Plan', category: 'claude', icon: FileText },
  { type: 'claude.apply', label: 'Claude Apply', category: 'claude', icon: Play },
];

interface CategoryStyle {
  label: string;
  headerColor: string;
  iconBg: string;
  cardBg: string;
  cardBorder: string;
  cardHover: string;
}

const CATEGORY_STYLES: Record<Category, CategoryStyle> = {
  control: {
    label: 'Control Flow',
    headerColor: 'text-control-text',
    iconBg: 'bg-control-muted text-control',
    cardBg: 'bg-gradient-to-br from-control-muted to-bg-tertiary',
    cardBorder: 'border-border-secondary',
    cardHover: 'hover:border-control hover:shadow-node',
  },
  github: {
    label: 'GitHub',
    headerColor: 'text-github-accent',
    iconBg: 'bg-github-muted text-github-accent',
    cardBg: 'bg-gradient-to-br from-github-muted to-bg-tertiary',
    cardBorder: 'border-border-secondary',
    cardHover: 'hover:border-github-accent hover:shadow-node',
  },
  git: {
    label: 'Git',
    headerColor: 'text-git-accent',
    iconBg: 'bg-git-muted text-git',
    cardBg: 'bg-gradient-to-br from-git-muted to-bg-tertiary',
    cardBorder: 'border-border-secondary',
    cardHover: 'hover:border-git-accent hover:shadow-node',
  },
  claude: {
    label: 'Claude AI',
    headerColor: 'text-claude-accent',
    iconBg: 'bg-claude-muted text-claude',
    cardBg: 'bg-gradient-to-br from-claude-muted to-bg-tertiary',
    cardBorder: 'border-border-secondary',
    cardHover: 'hover:border-claude-accent hover:shadow-node',
  },
};

const CATEGORIES: Category[] = ['control', 'github', 'git', 'claude'];

interface NodePaletteProps {
  onDragStart: (type: NodeType, x: number, y: number) => void;
}

export function NodePalette({ onDragStart }: NodePaletteProps) {
  return (
    <aside
      className="w-64 bg-bg-secondary border-r border-border-primary overflow-y-auto p-4"
      aria-label="Node palette"
    >
      <h2 className="font-display text-sm font-semibold text-text-secondary uppercase tracking-widest mb-4 px-1">
        Nodes
      </h2>
      {CATEGORIES.map((category) => {
        const style = CATEGORY_STYLES[category];
        const items = PALETTE_ITEMS.filter((i) => i.category === category);

        return (
          <div key={category} className="mb-5">
            <h3
              className={`font-display text-[11px] font-medium uppercase tracking-widest mb-2 px-1 ${style.headerColor}`}
            >
              {style.label}
            </h3>
            <ul className="space-y-1.5" role="list" aria-label={`${style.label} nodes`}>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.type}>
                    <div
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onDragStart(item.type, e.clientX, e.clientY);
                      }}
                      className={`
                        w-full text-left px-3 py-2.5 rounded-lg border
                        cursor-grab active:cursor-grabbing select-none
                        transition-all duration-200 ease-out
                        hover:scale-105
                        ${style.cardBg} ${style.cardBorder} ${style.cardHover}
                      `}
                      role="button"
                      tabIndex={0}
                      aria-label={`Drag to add ${item.label} node`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-md ${style.iconBg}`}
                          aria-hidden="true"
                        >
                          <Icon size={16} strokeWidth={2} />
                        </span>
                        <div className="flex flex-col min-w-0">
                          <span className="font-display text-sm font-medium text-text-primary truncate">
                            {item.label}
                          </span>
                          <span className="font-technical text-[10px] text-text-tertiary truncate">
                            {item.type}
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </aside>
  );
}
