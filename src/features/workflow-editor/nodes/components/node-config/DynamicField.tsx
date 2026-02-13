import { useCallback } from 'react';
import {
  TextInput,
  NumberInput,
  SelectInput,
  TemplateTextarea,
  type TemplateVariable,
} from '@/components/ui/form';
import type { FieldSchema } from '@/features/workflow-editor/nodes/catalog';

export interface ConfigFieldOption {
  label: string;
  value: string;
  disabled?: boolean;
}

interface DynamicFieldProps {
  field: FieldSchema;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  variables: TemplateVariable[];
  optionsOverride?: ConfigFieldOption[];
  disabled?: boolean;
}

export function DynamicField({
  field,
  value,
  onChange,
  variables,
  optionsOverride,
  disabled,
}: DynamicFieldProps) {
  const handleChange = useCallback(
    (nextValue: unknown) => onChange(field.key, nextValue),
    [field.key, onChange],
  );

  switch (field.type) {
    case 'text':
      return (
        <TextInput
          label={field.label}
          value={String(value ?? field.defaultValue ?? '')}
          onChange={handleChange as (v: string) => void}
          placeholder={field.placeholder}
          hint={field.description}
          required={field.required}
          mono
        />
      );

    case 'number':
      return (
        <NumberInput
          label={field.label}
          value={value !== undefined && value !== '' ? Number(value) : (field.defaultValue as number | undefined)}
          onChange={handleChange as (v: number | undefined) => void}
          placeholder={field.placeholder}
          hint={field.description}
          required={field.required}
          min={0}
        />
      );

    case 'select':
      return (
        <SelectInput
          label={field.label}
          value={String(value ?? field.defaultValue ?? '')}
          onChange={handleChange as (v: string) => void}
          options={(optionsOverride ?? field.options ?? []).map((option) => ({
            label: option.label,
            value: option.value,
            disabled: option.disabled,
          }))}
          placeholder={`Select ${field.label.toLowerCase()}...`}
          hint={field.description}
          required={field.required}
          disabled={disabled}
        />
      );

    case 'textarea':
      return (
        <TemplateTextarea
          label={field.label}
          value={String(value ?? field.defaultValue ?? '')}
          onChange={handleChange as (v: string) => void}
          placeholder={field.placeholder}
          hint={field.description}
          required={field.required}
          rows={4}
          variables={variables}
        />
      );

    case 'template':
      return (
        <TemplateTextarea
          label={field.label}
          value={String(value ?? field.defaultValue ?? '')}
          onChange={handleChange as (v: string) => void}
          placeholder={field.placeholder}
          hint={field.description}
          required={field.required}
          rows={1}
          variables={variables}
        />
      );

    default:
      return null;
  }
}
