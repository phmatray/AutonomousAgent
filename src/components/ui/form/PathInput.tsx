import { useState, useCallback } from 'react';
import { FormField } from './FormField';
import { validate, type ValidationRule } from './types';

interface PathInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  validation?: ValidationRule;
}

export function PathInput({
  label,
  value,
  onChange,
  placeholder = '/path/to/directory',
  hint,
  required,
  disabled,
  validation,
}: PathInputProps) {
  const [touched, setTouched] = useState(false);
  const rules = validation ?? (required ? { required: true } : undefined);
  const result = touched ? validate(value, rules) : { valid: true };

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleBlur = useCallback(() => {
    setTouched(true);
  }, []);

  return (
    <FormField
      label={label}
      error={result.valid ? undefined : result.error}
      hint={hint}
      required={required}
    >
      {(id) => (
        <div className="relative">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <svg
              className="w-4 h-4 text-text-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
          </div>
          <input
            id={id}
            type="text"
            value={value}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={placeholder}
            disabled={disabled}
            className={`
              w-full rounded-md pl-9 pr-3 py-2 text-sm text-text-primary font-technical
              bg-bg-tertiary border transition-colors
              placeholder:text-text-tertiary
              focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus
              disabled:opacity-50 disabled:cursor-not-allowed
              ${!result.valid ? 'border-state-error/70 focus:ring-state-error/50 focus:border-state-error' : 'border-border-primary hover:border-border-hover'}
            `}
            aria-invalid={!result.valid}
            aria-describedby={!result.valid ? `${id}-error` : hint ? `${id}-hint` : undefined}
          />
        </div>
      )}
    </FormField>
  );
}
