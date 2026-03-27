import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';

vi.mock('@/modules/localization/useModuleTranslation', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

describe('PlaybookStatusBadge', () => {
  it('renders translated status label and spinner class for running', () => {
    const { container } = render(<PlaybookStatusBadge status='running' />);
    expect(screen.getByText('status.running')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('falls back to pending config for unknown status values', () => {
    render(<PlaybookStatusBadge status={'unknown' as any} />);
    expect(screen.getByText('status.unknown')).toBeInTheDocument();
  });
});
