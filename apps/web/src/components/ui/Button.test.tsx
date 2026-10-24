import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('calls onClick when enabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and explains why when disabledReason is set', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabledReason="Arrives in Module 02.">
        Connect
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Connect/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Arrives in Module 02.');
    expect(button).toHaveAccessibleDescription('Disabled: Arrives in Module 02.');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is disabled and busy while loading', () => {
    render(<Button loading>Working</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
