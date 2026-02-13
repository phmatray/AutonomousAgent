export function ConditionBranchHelp() {
  return (
    <div className="mx-4 mt-4 px-3 py-2 rounded-md bg-control-muted/30 border border-border-secondary text-xs text-text-secondary space-y-1">
      <p className="font-medium text-text-primary">Branch Outputs</p>
      <p>
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-600 mr-1.5 align-middle" />
        <strong>Right (green)</strong> - true branch
      </p>
      <p>
        <span className="inline-block w-2 h-2 rounded-full bg-red-600 mr-1.5 align-middle" />
        <strong>Left (red)</strong> - false branch
      </p>
    </div>
  );
}
