import { useCallback, useState, type ChangeEvent } from 'react';

interface RawJsonEditorProps {
  config: Record<string, unknown>;
  onUpdate: (config: Record<string, unknown>) => void;
}

export function RawJsonEditor({ config, onUpdate }: RawJsonEditorProps) {
  const [raw, setRaw] = useState(() => JSON.stringify(config, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const text = event.target.value;
      setRaw(text);
      try {
        const parsed = JSON.parse(text);
        setParseError(null);
        onUpdate(parsed);
      } catch (error) {
        setParseError((error as Error).message);
      }
    },
    [onUpdate],
  );

  return (
    <div className="space-y-1.5">
      <textarea
        value={raw}
        onChange={handleChange}
        className={`
          w-full rounded-md px-3 py-2 text-xs text-text-primary font-technical
          bg-bg-tertiary border transition-colors resize-y min-h-[100px] leading-relaxed
          focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus
          ${parseError ? 'border-state-error/70' : 'border-border-primary hover:border-border-hover'}
        `}
        aria-label="Raw JSON configuration"
        spellCheck={false}
      />
      {parseError && (
        <p className="text-xs text-state-error" role="alert">
          {parseError}
        </p>
      )}
    </div>
  );
}
