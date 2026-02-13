interface NodeTypeIconProps {
  nodeType: string;
}

export function NodeTypeIcon({ nodeType }: NodeTypeIconProps) {
  const category = nodeType.split('.')[0];
  const colorClass =
    category === 'github'
      ? 'text-github-accent'
      : category === 'git'
        ? 'text-git-accent'
        : category === 'claude'
          ? 'text-claude-accent'
          : 'text-control-text';

  return (
    <span className={`text-xs font-technical ${colorClass}`}>
      {nodeType}
    </span>
  );
}
