import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from './password-input';

describe('PasswordInput', () => {
  it('hides the value by default and toggles it with the eye button', async () => {
    render(<PasswordInput placeholder='pwd' />);

    const input = screen.getByPlaceholderText('pwd');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'actionShowPassword' }));
    expect(input).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'actionHidePassword' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('forwards native props and ref to the inner input', () => {
    render(<PasswordInput placeholder='pwd' disabled />);

    const input = screen.getByPlaceholderText('pwd');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'pwd');
  });
});
