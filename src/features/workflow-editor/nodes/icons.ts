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

export const NODE_ICONS: Record<NodeType, LucideIcon> = {
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
