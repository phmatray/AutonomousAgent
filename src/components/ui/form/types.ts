export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: unknown) => string | undefined;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validate(value: unknown, rules?: ValidationRule): ValidationResult {
  if (!rules) return { valid: true };

  const str = typeof value === 'string' ? value : String(value ?? '');

  if (rules.required && str.trim() === '') {
    return { valid: false, error: 'This field is required' };
  }

  if (rules.minLength !== undefined && str.length < rules.minLength) {
    return { valid: false, error: `Minimum ${rules.minLength} characters` };
  }

  if (rules.maxLength !== undefined && str.length > rules.maxLength) {
    return { valid: false, error: `Maximum ${rules.maxLength} characters` };
  }

  if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
    return { valid: false, error: `Minimum value is ${rules.min}` };
  }

  if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
    return { valid: false, error: `Maximum value is ${rules.max}` };
  }

  if (rules.pattern && !rules.pattern.test(str)) {
    return { valid: false, error: 'Invalid format' };
  }

  if (rules.custom) {
    const customError = rules.custom(value);
    if (customError) return { valid: false, error: customError };
  }

  return { valid: true };
}

/** Extract template variable names from workflow nodes for autocomplete */
export interface TemplateVariable {
  label: string;
  value: string;
  description?: string;
}

/** Parse {{...}} references from text and return cursor position info */
export function findTemplateToken(
  text: string,
  cursorPos: number,
): { token: string; start: number; end: number } | null {
  // Walk backwards from cursor to find opening {{
  let i = cursorPos - 1;
  while (i >= 1) {
    if (text[i - 1] === '{' && text[i] === '{') {
      const start = i - 1;
      // Find where the token ends (cursor position or closing }})
      const closingIdx = text.indexOf('}}', start + 2);
      const end = closingIdx !== -1 && closingIdx < cursorPos ? closingIdx + 2 : cursorPos;
      const token = text.slice(start + 2, end);
      // Only return if we haven't passed a closing }}
      if (closingIdx === -1 || closingIdx >= cursorPos) {
        return { token, start, end };
      }
    }
    i--;
  }
  return null;
}
