import { useState, useCallback, useRef, useEffect } from 'react';
import { FormField } from './FormField';
import { validate, findTemplateToken, type ValidationRule, type TemplateVariable } from './types';

interface TemplateTextareaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  rows?: number;
  variables?: TemplateVariable[];
  validation?: ValidationRule;
}

export function TemplateTextarea({
  label,
  value,
  onChange,
  placeholder,
  hint,
  required,
  disabled,
  rows = 4,
  variables = [],
  validation,
}: TemplateTextareaProps) {
  const [touched, setTouched] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [filteredVars, setFilteredVars] = useState<TemplateVariable[]>([]);
  const [tokenInfo, setTokenInfo] = useState<{ start: number; end: number } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLUListElement>(null);

  const rules = validation ?? (required ? { required: true } : undefined);
  const result = touched ? validate(value, rules) : { valid: true };

  const updateSuggestions = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || variables.length === 0) {
      setShowSuggestions(false);
      return;
    }

    const cursorPos = textarea.selectionStart;
    const token = findTemplateToken(value, cursorPos);

    if (token) {
      const query = token.token.toLowerCase();
      const matches = variables.filter(
        (v) =>
          v.label.toLowerCase().includes(query) ||
          v.value.toLowerCase().includes(query),
      );
      setFilteredVars(matches);
      setTokenInfo({ start: token.start, end: token.end });
      setSelectedIdx(0);
      setShowSuggestions(matches.length > 0);
    } else {
      setShowSuggestions(false);
    }
  }, [value, variables]);

  const insertVariable = useCallback(
    (variable: TemplateVariable) => {
      if (!tokenInfo) return;
      const before = value.slice(0, tokenInfo.start);
      const after = value.slice(tokenInfo.end);
      const inserted = `{{${variable.value}}}`;
      const newValue = before + inserted + after;
      onChange(newValue);
      setShowSuggestions(false);

      // Restore cursor position after the inserted variable
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          const pos = before.length + inserted.length;
          textarea.selectionStart = pos;
          textarea.selectionEnd = pos;
          textarea.focus();
        }
      });
    },
    [tokenInfo, value, onChange],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleBlur = useCallback(() => {
    setTouched(true);
    // Delay hiding so clicks on suggestions register
    setTimeout(() => setShowSuggestions(false), 200);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showSuggestions) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((prev) => Math.min(prev + 1, filteredVars.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredVars[selectedIdx]) {
          e.preventDefault();
          insertVariable(filteredVars[selectedIdx]);
        }
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    },
    [showSuggestions, filteredVars, selectedIdx, insertVariable],
  );

  // Update suggestions whenever value changes or cursor moves
  useEffect(() => {
    updateSuggestions();
  }, [value, updateSuggestions]);

  // Scroll selected suggestion into view
  useEffect(() => {
    if (suggestionsRef.current) {
      const selected = suggestionsRef.current.children[selectedIdx] as HTMLElement | undefined;
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx]);

  return (
    <FormField
      label={label}
      error={result.valid ? undefined : result.error}
      hint={hint}
      required={required}
    >
      {(id) => (
        <div className="relative">
          <textarea
            ref={textareaRef}
            id={id}
            value={value}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onKeyUp={updateSuggestions}
            onClick={updateSuggestions}
            placeholder={placeholder}
            disabled={disabled}
            rows={rows}
            className={`
              w-full rounded-md px-3 py-2 text-sm text-text-primary font-technical
              bg-bg-tertiary border transition-colors resize-y
              placeholder:text-text-tertiary leading-relaxed
              focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus
              disabled:opacity-50 disabled:cursor-not-allowed
              ${!result.valid ? 'border-state-error/70 focus:ring-state-error/50 focus:border-state-error' : 'border-border-primary hover:border-border-hover'}
            `}
            aria-invalid={!result.valid}
            aria-describedby={!result.valid ? `${id}-error` : hint ? `${id}-hint` : undefined}
            aria-autocomplete={variables.length > 0 ? 'list' : undefined}
            aria-controls={showSuggestions ? `${id}-suggestions` : undefined}
            aria-expanded={showSuggestions}
          />

          {showSuggestions && (
            <ul
              ref={suggestionsRef}
              id={`${id}-suggestions`}
              role="listbox"
              className="absolute z-50 left-0 right-0 mt-1 max-h-40 overflow-y-auto rounded-md border border-border-primary bg-bg-elevated shadow-node"
            >
              {filteredVars.map((v, i) => (
                <li
                  key={v.value}
                  role="option"
                  aria-selected={i === selectedIdx}
                  className={`
                    px-3 py-2 cursor-pointer text-sm flex items-center justify-between
                    ${i === selectedIdx ? 'bg-control-muted text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary'}
                  `}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertVariable(v);
                  }}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <span className="font-technical text-xs">
                    {'{{'}
                    {v.value}
                    {'}}'}
                  </span>
                  {v.description && (
                    <span className="text-xs text-text-tertiary ml-2 truncate">
                      {v.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </FormField>
  );
}
