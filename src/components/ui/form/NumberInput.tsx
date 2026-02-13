import { useState, useCallback } from 'react';
import { FormField } from './FormField';
import { validate, type ValidationRule } from './types';

interface NumberInputProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  validation?: ValidationRule;
}

export function NumberInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  required,
  disabled,
  min,
  max,
  step,
  validation,
}: NumberInputProps) {
  const [touched, setTouched] = useState(false);

  const rules: ValidationRule | undefined = validation ?? {
    ...(required ? { required: true } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };

  const hasRules = Object.keys(rules).length > 0;
  const result = touched && hasRules ? validate(value, rules) : { valid: true };

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === '') {
        onChange(undefined);
        return;
      }
      const num = parseFloat(raw);
      if (!isNaN(num)) {
        onChange(num);
      }
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
          type="number"
          value={value ?? ''}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          className={`
            w-full rounded-md px-3 py-2 text-sm text-text-primary font-technical
            bg-bg-tertiary border transition-colors
            placeholder:text-text-tertiary
            focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus
            disabled:opacity-50 disabled:cursor-not-allowed
            ${!result.valid ? 'border-state-error/70 focus:ring-state-error/50 focus:border-state-error' : 'border-border-primary hover:border-border-hover'}
          `}
          aria-invalid={!result.valid}
          aria-describedby={!result.valid ? `${id}-error` : hint ? `${id}-hint` : undefined}
        />
      )}
    </FormField>
  );
}
