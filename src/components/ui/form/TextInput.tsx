import { useState, useCallback } from 'react';
import { FormField } from './FormField';
import { validate, type ValidationRule } from './types';

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  mono?: boolean;
  validation?: ValidationRule;
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  required,
  disabled,
  mono,
  validation,
}: TextInputProps) {
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
        <input
          id={id}
          type="text"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={`
            h-10 w-full rounded-md px-3 text-sm text-text-primary
            bg-bg-tertiary border transition-colors
            placeholder:text-text-tertiary
            focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus
            disabled:opacity-50 disabled:cursor-not-allowed
            ${mono ? 'font-technical' : ''}
            ${!result.valid ? 'border-state-error/70 focus:ring-state-error/50 focus:border-state-error' : 'border-border-primary hover:border-border-hover'}
          `}
          aria-invalid={!result.valid}
          aria-describedby={!result.valid ? `${id}-error` : hint ? `${id}-hint` : undefined}
        />
      )}
    </FormField>
  );
}
