import { describe, it, expect } from 'vitest';
import {
  parseImportedWorkflow,
  serializeWorkflowForExport,
  toEditorGraph,
  WORKFLOW_EXPORT_SCHEMA_VERSION,
} from './workflow-io';
import type { Workflow } from '@/types/workflow';

describe('workflow-io', () => {
  it('serializes workflows with schemaVersion envelope', () => {
    const workflow: Workflow = {
      id: '',
      name: 'Test Workflow',
      nodes: [
        {
          id: 'n1',
          type: 'trigger',
          config: { trigger_type: 'manual' },
          position: { x: 1, y: 2 },
        },
      ],
      edges: [],
      version: 1,
      createdAt: '',
      updatedAt: '',
    };

    const raw = JSON.parse(serializeWorkflowForExport(workflow)) as Record<string, unknown>;
    expect(raw.schemaVersion).toBe(WORKFLOW_EXPORT_SCHEMA_VERSION);
    expect(raw.workflow).toBeDefined();
  });

  it('parses legacy raw workflow payloads', () => {
    const legacy = JSON.stringify({
      name: 'Legacy Workflow',
      nodes: [{ id: 'n1', type: 'trigger', config: {}, position: { x: 10, y: 20 } }],
      edges: [],
    });

    const parsed = parseImportedWorkflow(legacy, (prefix, index) => `${prefix}-${index}`);
    expect(parsed.name).toBe('Legacy Workflow');
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].id).toBe('n1');
    expect(parsed.nodes[0].type).toBe('trigger');
  });

  it('parses versioned payloads and migrates node_type/source_handle aliases', () => {
    const versioned = JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-02-13T00:00:00.000Z',
      workflow: {
        name: 'Aliased Workflow',
        nodes: [{ id: 'n1', node_type: 'github.readIssues', config: { owner: 'o', repo: 'r' } }],
        edges: [
          {
            id: 'e1',
            source: 'n1',
            target: 'n2',
            source_handle: 'true',
            target_handle: 'in',
          },
        ],
      },
    });

    const parsed = parseImportedWorkflow(versioned, (prefix, index) => `${prefix}-${index}`);
    expect(parsed.nodes[0].type).toBe('github.readIssues');
    expect(parsed.edges).toHaveLength(0); // n2 does not exist, edge filtered out
  });

  it('throws on unsupported schemaVersion', () => {
    const bad = JSON.stringify({
      schemaVersion: 999,
      workflow: { name: 'Bad', nodes: [], edges: [] },
    });

    expect(() => parseImportedWorkflow(bad)).toThrow('Unsupported workflow schemaVersion');
  });

  it('maps workflow nodes to editor graph with catalog labels', () => {
    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Label Mapping Workflow',
      nodes: [
        { id: 'n1', type: 'github.readIssues', config: {}, position: { x: 10, y: 20 } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n1', sourceHandle: 'true', targetHandle: 'in' },
      ],
      version: 1,
      createdAt: '',
      updatedAt: '',
    };

    const graph = toEditorGraph(workflow);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].data.label).toBe('Read Issues');
    expect(graph.nodes[0].data.nodeType).toBe('github.readIssues');
    expect(graph.edges[0].sourceHandle).toBe('true');
    expect(graph.edges[0].targetHandle).toBe('in');
  });
});
