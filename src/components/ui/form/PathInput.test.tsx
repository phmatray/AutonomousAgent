import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PathInput } from './PathInput';

function ControlledPathInput({
  required,
  onChangeSpy = vi.fn(),
}: {
  required?: boolean;
  onChangeSpy?: (value: string) => void;
}) {
  const [value, setValue] = useState('');

  return (
    <PathInput
      label="Local Path"
      value={value}
      onChange={(next) => {
        onChangeSpy(next);
        setValue(next);
      }}
      required={required}
    />
  );
}

describe('PathInput', () => {
  it('renders with the default placeholder', () => {
    render(<PathInput label="Local Path" value="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('/path/to/directory')).toBeInTheDocument();
  });

  it('calls onChange with the updated value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ControlledPathInput onChangeSpy={onChange} />);

    await user.type(screen.getByRole('textbox', { name: /local path/i }), '/tmp/repo');

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith('/tmp/repo');
  });

  it('shows required validation error after blur when value is empty', async () => {
    const user = userEvent.setup();

    render(<ControlledPathInput required />);

    const input = screen.getByRole('textbox', { name: /local path/i });
    await user.click(input);
    await user.tab();

    expect(screen.getByRole('alert')).toHaveTextContent('This field is required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows hint text when there is no validation error', () => {
    render(
      <PathInput
        label="Local Path"
        value="/tmp/repo"
        onChange={vi.fn()}
        hint="Use an absolute path"
      />,
    );

    expect(screen.getByText('Use an absolute path')).toBeInTheDocument();
  });
});
