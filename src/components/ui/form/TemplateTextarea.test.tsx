import { useState } from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateTextarea } from './TemplateTextarea';
import type { TemplateVariable } from './types';

const variables: TemplateVariable[] = [
  { label: 'Issue Number', value: 'issue.number', description: 'GitHub issue number' },
  { label: 'Issue Title', value: 'issue.title', description: 'GitHub issue title' },
  { label: 'Repository Name', value: 'repo.name', description: 'Repository slug' },
];

function ControlledTextarea({
  initialValue = '',
  required,
}: {
  initialValue?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <TemplateTextarea
      label="Prompt"
      value={value}
      onChange={setValue}
      variables={variables}
      required={required}
      hint="Use {{...}} variables"
    />
  );
}

beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      writable: true,
    });
  }
});

describe('TemplateTextarea', () => {
  function setTemplateInput(textarea: HTMLElement, value: string) {
    fireEvent.change(textarea, { target: { value } });
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.setSelectionRange(value.length, value.length);
    }
    fireEvent.keyUp(textarea, { key: 'x' });
  }

  it('shows required validation error after blur when empty', async () => {
    const user = userEvent.setup();
    render(<ControlledTextarea required />);

    const textarea = screen.getByRole('textbox', { name: /prompt/i });
    await user.click(textarea);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText('This field is required')).toBeInTheDocument();
    });
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows variable suggestions while typing a template token and hides on escape', async () => {
    render(<ControlledTextarea />);

    const textarea = screen.getByRole('textbox', { name: /prompt/i });
    setTemplateInput(textarea, '{{issue.');

    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: /{{issue.number}}/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /{{issue.title}}/i })).toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('inserts the selected suggestion with keyboard navigation', async () => {
    render(<ControlledTextarea />);

    const textarea = screen.getByRole('textbox', { name: /prompt/i });
    setTemplateInput(textarea, '{{issue.');

    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    await waitFor(() => {
      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(textarea).toHaveValue('{{issue.title}}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('inserts a suggestion on mouse selection', async () => {
    const user = userEvent.setup();
    render(<ControlledTextarea />);

    const textarea = screen.getByRole('textbox', { name: /prompt/i });
    setTemplateInput(textarea, '{{rep');

    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    await user.click(screen.getByRole('option', { name: /{{repo.name}}/i }));

    expect(textarea).toHaveValue('{{repo.name}}');
  });
});
