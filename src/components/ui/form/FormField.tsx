import { type ReactNode, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (id: string) => ReactNode;
}

const shakeVariants = {
  shake: {
    x: [0, -6, 6, -4, 4, -2, 2, 0],
    transition: { duration: 0.4 },
  },
};

export function FormField({ label, htmlFor, error, hint, required, children }: FormFieldProps) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  return (
    <motion.div
      className="space-y-1.5"
      variants={shakeVariants}
      animate={error ? 'shake' : undefined}
    >
      <label
        htmlFor={fieldId}
        className="block text-xs font-medium text-text-secondary uppercase tracking-wider"
      >
        {label}
        {required && (
          <span className="text-state-error ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {children(fieldId)}

      <AnimatePresence mode="wait">
        {hint && !error && (
          <motion.p
            key="hint"
            id={hintId}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="text-xs text-text-tertiary"
          >
            {hint}
          </motion.p>
        )}

        {error && (
          <motion.p
            key="error"
            id={errorId}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="text-xs text-state-error"
            role="alert"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
