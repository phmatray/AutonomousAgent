import type { LucideIcon } from 'lucide-react';
import type { NodeType } from '@/types/workflow';
import { NODE_METADATA } from '@/features/workflow-editor/nodes/catalog';
import { NODE_ICONS } from '@/features/workflow-editor/nodes/icons';
import {
  NODE_FEATURES,
  NODE_PALETTE_ORDER,
  type NodeFeature,
} from '@/features/workflow-editor/nodes/features';

interface PaletteItem {
  type: NodeType;
  label: string;
  category: NodeFeature;
  icon: LucideIcon;
}

const PALETTE_ITEMS: PaletteItem[] = NODE_PALETTE_ORDER.map((type) => ({
  type,
  label: NODE_METADATA[type].label,
  category: NODE_METADATA[type].category,
  icon: NODE_ICONS[type],
}));

interface CategoryStyle {
  headerColor: string;
  iconBg: string;
  cardBg: string;
  cardBorder: string;
  cardHover: string;
}

const CATEGORY_STYLES: Record<NodeFeature, CategoryStyle> = {
  control: {
    headerColor: 'text-control-text',
    iconBg: 'bg-control-muted text-control',
    cardBg: 'bg-gradient-to-br from-control-muted to-bg-tertiary',
    cardBorder: 'border-border-secondary',
    cardHover: 'hover:border-control hover:shadow-node',
  },
  github: {
    headerColor: 'text-github-accent',
    iconBg: 'bg-github-muted text-github-accent',
    cardBg: 'bg-gradient-to-br from-github-muted to-bg-tertiary',
    cardBorder: 'border-border-secondary',
    cardHover: 'hover:border-github-accent hover:shadow-node',
  },
  git: {
    headerColor: 'text-git-accent',
    iconBg: 'bg-git-muted text-git',
    cardBg: 'bg-gradient-to-br from-git-muted to-bg-tertiary',
    cardBorder: 'border-border-secondary',
    cardHover: 'hover:border-git-accent hover:shadow-node',
  },
  claude: {
    headerColor: 'text-claude-accent',
    iconBg: 'bg-claude-muted text-claude',
    cardBg: 'bg-gradient-to-br from-claude-muted to-bg-tertiary',
    cardBorder: 'border-border-secondary',
    cardHover: 'hover:border-claude-accent hover:shadow-node',
  },
};

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
      {NODE_FEATURES.map((feature) => {
        const style = CATEGORY_STYLES[feature.key];
        const items = PALETTE_ITEMS.filter((i) => i.category === feature.key);

        return (
          <div key={feature.key} className="mb-5">
            <h3
              className={`font-display text-[11px] font-medium uppercase tracking-widest mb-2 px-1 ${style.headerColor}`}
            >
              {feature.label}
            </h3>
            <ul className="space-y-1.5" role="list" aria-label={`${feature.label} nodes`}>
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
