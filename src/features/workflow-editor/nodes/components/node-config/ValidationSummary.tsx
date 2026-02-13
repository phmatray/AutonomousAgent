import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';

interface ValidationSummaryProps {
  nodeId: string;
}

export function ValidationSummary({ nodeId }: ValidationSummaryProps) {
  const validateNodeConfig = useEditorStore((s) => s.validateNodeConfig);
  const result = validateNodeConfig(nodeId);

  if (result.valid) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-state-success px-2 py-1.5 rounded-md bg-state-success/10">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        Configuration valid
      </div>
    );
  }

  return (
    <div className="text-xs text-state-error px-2 py-1.5 rounded-md bg-state-error/10">
      <div className="flex items-center gap-1.5 mb-1">
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        {result.errors.length} field{result.errors.length !== 1 ? 's' : ''} need attention
      </div>
      <ul className="pl-5 space-y-0.5 list-disc">
        {result.errors.map((err) => (
          <li key={err.key}>{err.message}</li>
        ))}
      </ul>
    </div>
  );
}
