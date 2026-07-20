import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SourceGroupRow } from './SourceGroupRow';

describe('SourceGroupRow', () => {
  it('shows the label and count, and toggles children open/closed', () => {
    render(
      <SourceGroupRow label='example.com/services' rootUrl='https://example.com/services' count={3} status='ready'>
        <div>child-a</div>
      </SourceGroupRow>,
    );
    expect(screen.getByText('example.com/services')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // collapsed by default
    expect(screen.queryByText('child-a')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'example.com/services' }));
    expect(screen.getByText('child-a')).toBeInTheDocument();
  });
});
