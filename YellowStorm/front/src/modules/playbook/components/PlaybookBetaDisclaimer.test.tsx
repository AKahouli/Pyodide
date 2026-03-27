import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookBetaDisclaimer } from './PlaybookBetaDisclaimer';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const STORAGE_KEY = 'yellostorm_playbook_beta_dismissed';

describe('PlaybookBetaDisclaimer', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('shows dialog when not previously dismissed', () => {
    render(<PlaybookBetaDisclaimer />);
    expect(screen.getByText('beta.title')).toBeInTheDocument();
    expect(screen.getByText('beta.disclaimer1')).toBeInTheDocument();
    expect(screen.getByText('beta.understood')).toBeInTheDocument();
  });

  it('does not show dialog when previously dismissed', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    render(<PlaybookBetaDisclaimer />);
    expect(screen.queryByText('beta.title')).not.toBeInTheDocument();
  });

  it('persists dismissal to localStorage when checkbox is checked', async () => {
    render(<PlaybookBetaDisclaimer />);
    const checkbox = screen.getByRole('checkbox');
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByText('beta.understood'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('does not persist dismissal when checkbox is unchecked', async () => {
    render(<PlaybookBetaDisclaimer />);
    await userEvent.click(screen.getByText('beta.understood'));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
