import type { NodeType } from '@/types/workflow';

export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'template';

export interface FieldOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  description?: string;
  options?: FieldOption[];
  defaultValue?: string | number;
}

export interface OutputVariable {
  name: string;
  description: string;
}

export interface NodeConfigSchema {
  fields: FieldSchema[];
  outputs: OutputVariable[];
}

// -- Control Flow nodes --

const triggerSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'trigger_type',
      label: 'Trigger Type',
      type: 'select',
      required: false,
      description: 'How this workflow is triggered',
      options: [
        { label: 'Manual', value: 'manual' },
        { label: 'Cron', value: 'cron' },
        { label: 'Webhook', value: 'webhook' },
        { label: 'State Change', value: 'state' },
      ],
      defaultValue: 'manual',
    },
  ],
  outputs: [
    { name: 'triggered_at', description: 'ISO timestamp when the workflow was triggered' },
    { name: 'trigger_type', description: 'The type of trigger that started execution' },
  ],
};

const conditionSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'condition',
      label: 'Condition',
      type: 'template',
      required: true,
      placeholder: '{{nodeId.field}}',
      description: 'Value to evaluate (supports template references)',
    },
    {
      key: 'operator',
      label: 'Operator',
      type: 'select',
      required: false,
      description: 'Comparison operator',
      options: [
        { label: 'Not Empty', value: 'not_empty' },
        { label: 'Exists', value: 'exists' },
        { label: 'Equals', value: 'eq' },
        { label: 'Not Equals', value: 'neq' },
        { label: 'Greater Than', value: 'gt' },
        { label: 'Less Than', value: 'lt' },
        { label: 'Greater or Equal', value: 'gte' },
        { label: 'Less or Equal', value: 'lte' },
      ],
      defaultValue: 'not_empty',
    },
    {
      key: 'value',
      label: 'Compare Value',
      type: 'template',
      required: false,
      placeholder: 'Value to compare against',
      description: 'Not needed for "exists" or "not_empty" operators',
    },
  ],
  outputs: [
    { name: 'result', description: 'Boolean result of the condition evaluation' },
    { name: 'branch', description: '"true" or "false" indicating which branch to take' },
  ],
};

const loopSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'items',
      label: 'Items',
      type: 'template',
      required: true,
      placeholder: '{{readIssues.issues}}',
      description: 'Array to iterate over (template reference or literal)',
    },
    {
      key: 'max_iterations',
      label: 'Max Iterations',
      type: 'number',
      required: false,
      placeholder: '10',
      description: 'Maximum number of iterations (defaults to array length)',
    },
  ],
  outputs: [
    { name: 'current_item', description: 'The current iteration item' },
    { name: 'index', description: 'Current iteration index (0-based)' },
    { name: 'total', description: 'Total number of items being iterated' },
    { name: 'items', description: 'The full list of items' },
  ],
};

const delaySchema: NodeConfigSchema = {
  fields: [
    {
      key: 'seconds',
      label: 'Seconds',
      type: 'number',
      required: true,
      placeholder: '5',
      description: 'Number of seconds to wait',
      defaultValue: 1,
    },
  ],
  outputs: [
    { name: 'waited_seconds', description: 'Duration of the delay in seconds' },
  ],
};

// -- GitHub nodes --

const githubSyncSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'credential_id',
      label: 'Credentials',
      type: 'select',
      required: false,
      description: 'GitHub account credentials to use for this node',
    },
    {
      key: 'owner',
      label: 'Owner',
      type: 'text',
      required: true,
      placeholder: 'octocat',
      description: 'GitHub repository owner or organization',
    },
    {
      key: 'repo',
      label: 'Repository',
      type: 'text',
      required: true,
      placeholder: 'my-project',
      description: 'Repository name',
    },
    {
      key: 'path',
      label: 'Local Path',
      type: 'text',
      required: true,
      placeholder: '/tmp/repos',
      description: 'Local filesystem path to clone into',
    },
  ],
  outputs: [
    { name: 'repo_path', description: 'Full path to the local repository' },
    { name: 'owner', description: 'Repository owner' },
    { name: 'repo', description: 'Repository name' },
  ],
};

const githubReadIssuesSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'credential_id',
      label: 'Credentials',
      type: 'select',
      required: false,
      description: 'GitHub account credentials to use for this node',
    },
    {
      key: 'owner',
      label: 'Owner',
      type: 'template',
      required: true,
      placeholder: '{{sync.owner}}',
      description: 'Repository owner (supports template references)',
    },
    {
      key: 'repo',
      label: 'Repository',
      type: 'template',
      required: true,
      placeholder: '{{sync.repo}}',
      description: 'Repository name (supports template references)',
    },
  ],
  outputs: [
    { name: 'issues', description: 'Array of issue objects (number, title, body, state, labels, assignees)' },
    { name: 'count', description: 'Number of open issues' },
  ],
};

const githubCreatePrSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'credential_id',
      label: 'Credentials',
      type: 'select',
      required: false,
      description: 'GitHub account credentials to use for this node',
    },
    {
      key: 'owner',
      label: 'Owner',
      type: 'template',
      required: true,
      placeholder: '{{sync.owner}}',
      description: 'Repository owner (supports template references)',
    },
    {
      key: 'repo',
      label: 'Repository',
      type: 'template',
      required: true,
      placeholder: '{{sync.repo}}',
      description: 'Repository name (supports template references)',
    },
    {
      key: 'title',
      label: 'PR Title',
      type: 'template',
      required: true,
      placeholder: 'feat: implement feature X',
      description: 'Pull request title',
    },
    {
      key: 'body',
      label: 'PR Body',
      type: 'textarea',
      required: false,
      placeholder: 'Describe the changes...',
      description: 'Pull request description (markdown)',
    },
    {
      key: 'head',
      label: 'Head Branch',
      type: 'template',
      required: true,
      placeholder: '{{branch.branch_name}}',
      description: 'Source branch containing changes',
    },
    {
      key: 'base',
      label: 'Base Branch',
      type: 'text',
      required: false,
      placeholder: 'develop',
      description: 'Target branch for the PR (defaults to "develop")',
      defaultValue: 'develop',
    },
  ],
  outputs: [
    { name: 'number', description: 'Pull request number' },
    { name: 'html_url', description: 'URL to the pull request on GitHub' },
    { name: 'title', description: 'Pull request title' },
  ],
};

// -- Git nodes --

const gitWorktreeSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'repo_path',
      label: 'Repository Path',
      type: 'template',
      required: false,
      placeholder: '{{sync.repo_path}}',
      description: 'Path to the main repository (falls back to working directory)',
    },
    {
      key: 'worktree_path',
      label: 'Worktree Path',
      type: 'template',
      required: true,
      placeholder: '/tmp/worktrees/issue-42',
      description: 'Filesystem path for the new worktree',
    },
    {
      key: 'branch_name',
      label: 'Branch Name',
      type: 'template',
      required: true,
      placeholder: 'feature/issue-42',
      description: 'Branch to create in the worktree',
    },
  ],
  outputs: [
    { name: 'worktree_path', description: 'Path to the created worktree' },
    { name: 'branch_name', description: 'Branch created in the worktree' },
  ],
};

const gitBranchSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'repo_path',
      label: 'Repository Path',
      type: 'template',
      required: false,
      placeholder: '{{sync.repo_path}}',
      description: 'Path to the repository (falls back to working directory)',
    },
    {
      key: 'branch_type',
      label: 'Branch Type',
      type: 'select',
      required: false,
      description: 'Gitflow branch type prefix',
      options: [
        { label: 'Feature', value: 'feature' },
        { label: 'Hotfix', value: 'hotfix' },
        { label: 'Release', value: 'release' },
      ],
      defaultValue: 'feature',
    },
    {
      key: 'name',
      label: 'Branch Name',
      type: 'template',
      required: true,
      placeholder: 'my-new-feature',
      description: 'Descriptive name (combined as "type/name")',
    },
  ],
  outputs: [
    { name: 'branch_name', description: 'Full gitflow branch name (e.g. "feature/my-new-feature")' },
  ],
};

const gitCommitSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'repo_path',
      label: 'Repository Path',
      type: 'template',
      required: false,
      placeholder: '{{sync.repo_path}}',
      description: 'Path to the repository (falls back to working directory)',
    },
    {
      key: 'commit_type',
      label: 'Commit Type',
      type: 'select',
      required: true,
      description: 'Conventional commit type',
      options: [
        { label: 'feat', value: 'feat' },
        { label: 'fix', value: 'fix' },
        { label: 'docs', value: 'docs' },
        { label: 'style', value: 'style' },
        { label: 'refactor', value: 'refactor' },
        { label: 'perf', value: 'perf' },
        { label: 'test', value: 'test' },
        { label: 'chore', value: 'chore' },
      ],
      defaultValue: 'feat',
    },
    {
      key: 'scope',
      label: 'Scope',
      type: 'text',
      required: false,
      placeholder: 'editor',
      description: 'Optional commit scope',
    },
    {
      key: 'description',
      label: 'Description',
      type: 'template',
      required: true,
      placeholder: 'add loop node support',
      description: 'Commit message description',
    },
    {
      key: 'gitmoji',
      label: 'Gitmoji',
      type: 'text',
      required: false,
      placeholder: 'auto',
      description: 'Optional gitmoji override (auto-selected if omitted)',
    },
  ],
  outputs: [
    { name: 'sha', description: 'The commit SHA' },
    { name: 'message', description: 'The full formatted commit message' },
  ],
};

// -- Claude nodes --

const claudeAnalyzeSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'prompt',
      label: 'Analysis Prompt',
      type: 'textarea',
      required: true,
      placeholder: 'Analyze the following issue and identify affected files...',
      description: 'Prompt sent to Claude for analysis',
    },
    {
      key: 'working_dir',
      label: 'Working Directory',
      type: 'template',
      required: false,
      placeholder: '{{sync.repo_path}}',
      description: 'Override for working directory (falls back to context)',
    },
    {
      key: 'timeout_secs',
      label: 'Timeout (seconds)',
      type: 'number',
      required: false,
      placeholder: '120',
      description: 'Maximum time to wait for Claude response',
    },
  ],
  outputs: [
    { name: 'analysis', description: 'The analysis text generated by Claude' },
  ],
};

const claudePlanSchema: NodeConfigSchema = {
  fields: [
    {
      key: 'prompt',
      label: 'Planning Prompt',
      type: 'textarea',
      required: true,
      placeholder: 'Create an implementation plan for...',
      description: 'Prompt sent to Claude for planning (supports template references)',
    },
    {
      key: 'working_dir',
      label: 'Working Directory',
      type: 'template',
      required: false,
      placeholder: '{{sync.repo_path}}',
      description: 'Override for working directory (falls back to context)',
    },
    {
      key: 'timeout_secs',
      label: 'Timeout (seconds)',
      type: 'number',
      required: false,
      placeholder: '120',
      description: 'Maximum time to wait for Claude response',
    },
  ],
  outputs: [
    { name: 'plan', description: 'The implementation plan generated by Claude' },
  ],
};

const claudeApplySchema: NodeConfigSchema = {
  fields: [
    {
      key: 'prompt',
      label: 'Execution Prompt',
      type: 'textarea',
      required: true,
      placeholder: 'Implement the following plan...',
      description: 'Instructions for Claude to execute (supports template references)',
    },
    {
      key: 'working_dir',
      label: 'Working Directory',
      type: 'template',
      required: false,
      placeholder: '{{sync.repo_path}}',
      description: 'Override for working directory (falls back to context)',
    },
    {
      key: 'timeout_secs',
      label: 'Timeout (seconds)',
      type: 'number',
      required: false,
      placeholder: '300',
      description: 'Maximum time to wait for Claude execution',
    },
  ],
  outputs: [
    { name: 'output', description: 'The CLI output from Claude execution' },
    { name: 'success', description: 'Boolean indicating execution success' },
  ],
};

// -- Main export --

export const NODE_SCHEMAS: Record<NodeType, NodeConfigSchema> = {
  // Control Flow
  trigger: triggerSchema,
  condition: conditionSchema,
  loop: loopSchema,
  delay: delaySchema,

  // GitHub
  'github.sync': githubSyncSchema,
  'github.readIssues': githubReadIssuesSchema,
  'github.createPR': githubCreatePrSchema,

  // Git
  'git.worktree': gitWorktreeSchema,
  'git.branch': gitBranchSchema,
  'git.commit': gitCommitSchema,

  // Claude
  'claude.analyze': claudeAnalyzeSchema,
  'claude.plan': claudePlanSchema,
  'claude.apply': claudeApplySchema,
};

export function getNodeSchema(nodeType: NodeType): NodeConfigSchema {
  return NODE_SCHEMAS[nodeType];
}

export function getRequiredFields(nodeType: NodeType): FieldSchema[] {
  return NODE_SCHEMAS[nodeType].fields.filter((f) => f.required);
}

export function getNodeOutputs(nodeType: NodeType): OutputVariable[] {
  return NODE_SCHEMAS[nodeType].outputs;
}
