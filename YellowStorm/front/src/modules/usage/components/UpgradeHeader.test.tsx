import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UpgradeHeader } from './UpgradeHeader';

describe('UpgradeHeader', () => {
  it('renders title/subtitle and invokes onBack', async () => {
    const onBack = vi.fn();
    render(<UpgradeHeader onBack={onBack} />);

    expect(screen.getByText('usage.upgrade.heading')).toBeInTheDocument();
    expect(screen.getByText('usage.upgrade.subheading')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'usage.upgrade.back' }));
    expect(onBack).toHaveBeenCalled();
  });
});
