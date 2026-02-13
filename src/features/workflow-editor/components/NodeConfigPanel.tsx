import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';

export function NodeConfigPanel() {
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const nodes = useEditorStore((s) => s.nodes);
  const updateNodeConfig = useEditorStore((s) => s.updateNodeConfig);
  const removeNode = useEditorStore((s) => s.removeNode);

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const config = (node.data.config ?? {}) as Record<string, string>;

  return (
    <aside
      className="w-72 bg-gray-900 border-l border-gray-700 overflow-y-auto p-4"
      aria-label="Node configuration"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">
          {node.data.label}
        </h2>
        <button
          type="button"
          onClick={() => removeNode(node.id)}
          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-900/30"
          aria-label={`Delete ${node.data.label} node`}
        >
          Delete
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <span className="block text-xs text-gray-400 mb-1">Type</span>
          <span className="text-sm text-gray-300">{node.data.nodeType}</span>
        </div>

        <div>
          <span className="block text-xs text-gray-400 mb-1">ID</span>
          <span className="text-xs text-gray-500 font-mono">{node.id}</span>
        </div>

        <hr className="border-gray-700" />

        <div>
          <label htmlFor="node-config-key" className="block text-xs text-gray-400 mb-1">
            Custom Config (JSON)
          </label>
          <textarea
            id="node-config-key"
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white font-mono resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={JSON.stringify(config, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                updateNodeConfig(node.id, parsed);
              } catch {
                // Allow user to keep editing invalid JSON
              }
            }}
            aria-label="Node configuration JSON"
          />
        </div>
      </div>
    </aside>
  );
}
