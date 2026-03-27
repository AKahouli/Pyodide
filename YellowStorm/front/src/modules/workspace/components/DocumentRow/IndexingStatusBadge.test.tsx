import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IndexingStatusBadge } from './IndexingStatusBadge';

describe('IndexingStatusBadge', () => {
  it('renders label for ready status', () => {
    render(<IndexingStatusBadge status='ready' />);
    expect(screen.getByText('Indexed')).toBeInTheDocument();
  });

  it('renders failed status with error context', () => {
    render(<IndexingStatusBadge status='failed' error='index error' />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
