import { useState, useCallback } from 'react';
import { FormField } from './FormField';
import { validate, type ValidationRule } from './types';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

interface SelectInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  validation?: ValidationRule;
}

export function SelectInput({
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
  required,
  disabled,
  validation,
}: SelectInputProps) {
  const [touched, setTouched] = useState(false);
  const rules = validation ?? (required ? { required: true } : undefined);
  const result = touched ? validate(value, rules) : { valid: true };

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange(e.target.value);
      setTouched(true);
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
        <select
          id={id}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={disabled}
          className={`
            w-full rounded-md px-3 py-2 text-sm text-text-primary
            bg-bg-tertiary border transition-colors appearance-none
            focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus
            disabled:opacity-50 disabled:cursor-not-allowed
            ${!result.valid ? 'border-state-error/70 focus:ring-state-error/50 focus:border-state-error' : 'border-border-primary hover:border-border-hover'}
          `}
          aria-invalid={!result.valid}
          aria-describedby={!result.valid ? `${id}-error` : hint ? `${id}-hint` : undefined}
        >
          {placeholder && (
            <option value="" disabled className="text-text-tertiary">
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
