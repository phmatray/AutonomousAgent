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
import { NODE_METADATA } from '@/features/workflow-editor/config-schemas';

type Category = 'control' | 'github' | 'git' | 'claude';

interface PaletteItem {
  type: NodeType;
  label: string;
  category: Category;
  icon: LucideIcon;
}

const NODE_ICONS: Record<NodeType, LucideIcon> = {
  trigger: Zap,
  condition: GitFork,
  loop: Repeat,
  delay: Timer,
  'github.sync': RefreshCw,
  'github.readIssues': BookOpen,
  'github.createPR': GitPullRequest,
  'git.worktree': FolderTree,
  'git.branch': GitBranch,
  'git.commit': GitCommitHorizontal,
  'claude.analyze': Search,
  'claude.plan': FileText,
  'claude.apply': Play,
};

const PALETTE_ORDER: NodeType[] = [
  'trigger',
  'condition',
  'loop',
  'delay',
  'github.sync',
  'github.readIssues',
  'github.createPR',
  'git.worktree',
  'git.branch',
  'git.commit',
  'claude.analyze',
  'claude.plan',
  'claude.apply',
];

const PALETTE_ITEMS: PaletteItem[] = PALETTE_ORDER.map((type) => ({
  type,
  label: NODE_METADATA[type].label,
  category: NODE_METADATA[type].category,
  icon: NODE_ICONS[type],
}));

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
  onQuickAdd?: (type: NodeType) => void;
}

export function NodePalette({ onDragStart, onQuickAdd }: NodePaletteProps) {
  return (
    <aside
      className="w-full md:w-64 md:min-w-64 bg-bg-secondary border-b md:border-b-0 md:border-r border-border-primary overflow-y-auto p-3 md:p-4 max-h-56 md:max-h-none"
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
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onDragStart(item.type, e.clientX, e.clientY);
                      }}
                      onClick={() => {
                        if (onQuickAdd && window.matchMedia('(max-width: 767px)').matches) {
                          onQuickAdd(item.type);
                        }
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && onQuickAdd) {
                          e.preventDefault();
                          onQuickAdd(item.type);
                        }
                      }}
                      className={`
                        w-full text-left px-3 py-2.5 rounded-lg border
                        cursor-grab active:cursor-grabbing select-none
                        transition-all duration-200 ease-out
                        hover:scale-105
                        ${style.cardBg} ${style.cardBorder} ${style.cardHover}
                      `}
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
                    </button>
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
