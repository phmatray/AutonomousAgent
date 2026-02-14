import type { Workflow } from '@/types/workflow';

export type SortOption = 'updated-desc' | 'name-asc' | 'name-desc' | 'nodes-desc';
export type WorkflowStatus = 'draft' | 'published';
export type TriggerMode = 'manual' | 'cron' | 'webhook' | 'state' | 'unknown';
export type VisibilityFilter = 'all' | 'published' | 'draft';
export type TriggerFilter = 'all' | 'scheduled' | 'on-demand';

export interface TriggerDetails {
  mode: TriggerMode;
  label: string;
  isScheduled: boolean;
  schedule?: string;
  timezone?: string;
  nextRunAt?: string;
}

export function getWorkflowStatus(workflow: Workflow): WorkflowStatus {
  const rawStatus = (workflow as Workflow & { status?: string }).status?.toLowerCase();
  if (rawStatus === 'published' || rawStatus === 'draft') {
    return rawStatus;
  }
  return 'draft';
}

export function getWorkflowTriggerDetails(workflow: Workflow): TriggerDetails {
  const persistedSchedule = workflow.schedule;
  if (persistedSchedule?.triggerType) {
    const triggerType = persistedSchedule.triggerType.toLowerCase();
    if (triggerType === 'cron') {
      return {
        mode: 'cron',
        label: 'Cron schedule',
        isScheduled: true,
        schedule: persistedSchedule.cronExpression,
        timezone: persistedSchedule.timezone,
        nextRunAt: persistedSchedule.nextRunAt,
      };
    }
    if (triggerType === 'webhook') {
      return {
        mode: 'webhook',
        label: 'Webhook trigger',
        isScheduled: false,
      };
    }
    if (triggerType === 'state_idle') {
      return {
        mode: 'state',
        label: 'State trigger',
        isScheduled: false,
      };
    }
    if (triggerType === 'manual') {
      return {
        mode: 'manual',
        label: 'On demand',
        isScheduled: false,
      };
    }
  }

  const triggerNode = workflow.nodes.find(
    (node) => node.type === 'trigger.cron' || node.type === 'trigger',
  );

  if (!triggerNode) {
    return {
      mode: 'manual',
      label: 'On demand',
      isScheduled: false,
    };
  }

  const config = triggerNode.config as Record<string, unknown> | undefined;
  const schedule = typeof config?.schedule === 'string' ? config.schedule.trim() : '';
  const timezone = typeof config?.timezone === 'string' ? config.timezone.trim() : '';

  if (triggerNode.type === 'trigger.cron') {
    return {
      mode: 'cron',
      label: 'Cron schedule',
      isScheduled: true,
      schedule: schedule || undefined,
      timezone: timezone || undefined,
    };
  }

  const triggerTypeRaw = typeof config?.trigger_type === 'string'
    ? config.trigger_type.trim().toLowerCase()
    : 'manual';
  const mode = (['manual', 'cron', 'webhook', 'state'].includes(triggerTypeRaw)
    ? triggerTypeRaw
    : 'unknown') as TriggerMode;

  if (mode === 'cron') {
    return {
      mode,
      label: 'Cron schedule',
      isScheduled: true,
      schedule: schedule || undefined,
      timezone: timezone || undefined,
    };
  }

  if (mode === 'webhook') {
    return {
      mode,
      label: 'Webhook trigger',
      isScheduled: false,
    };
  }

  if (mode === 'state') {
    return {
      mode,
      label: 'State trigger',
      isScheduled: false,
    };
  }

  if (mode === 'unknown') {
    return {
      mode,
      label: 'Custom trigger',
      isScheduled: false,
    };
  }

  return {
    mode: 'manual',
    label: 'On demand',
    isScheduled: false,
  };
}

export function formatNextRunTimestamp(nextRunAt?: string): string | null {
  if (!nextRunAt) return null;
  const date = new Date(nextRunAt);
  if (Number.isNaN(date.getTime())) return nextRunAt;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatWorkflowUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function filterAndSortWorkflows(
  workflows: Workflow[],
  options: {
    searchQuery: string;
    sortBy: SortOption;
    statusFilter: VisibilityFilter;
    triggerFilter: TriggerFilter;
  },
): Workflow[] {
  const normalizedSearch = options.searchQuery.trim().toLowerCase();
  const filteredBySearch = normalizedSearch
    ? workflows.filter((workflow) => {
      const name = workflow.name.toLowerCase();
      const description = workflow.description?.toLowerCase() ?? '';
      return name.includes(normalizedSearch) || description.includes(normalizedSearch);
    })
    : workflows;

  const filteredByStatus = filteredBySearch.filter((workflow) => {
    if (options.statusFilter === 'all') return true;
    return getWorkflowStatus(workflow) === options.statusFilter;
  });

  const filteredByTrigger = filteredByStatus.filter((workflow) => {
    if (options.triggerFilter === 'all') return true;
    const details = getWorkflowTriggerDetails(workflow);
    if (options.triggerFilter === 'scheduled') return details.isScheduled;
    return !details.isScheduled;
  });

  return [...filteredByTrigger].sort((a, b) => {
    switch (options.sortBy) {
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'nodes-desc':
        return b.nodes.length - a.nodes.length;
      case 'updated-desc':
      default:
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
  });
}
