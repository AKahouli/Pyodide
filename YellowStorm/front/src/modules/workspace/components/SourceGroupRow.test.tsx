import { describe, it, expect, vi } from 'vitest';
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

  it('calls onOpenInNavigator with the root url on double-click', () => {
    const onOpen = vi.fn();
    render(
      <SourceGroupRow label='example.com/services' rootUrl='https://example.com/services' count={3} onOpenInNavigator={onOpen}>
        <div>child-a</div>
      </SourceGroupRow>,
    );
    fireEvent.doubleClick(screen.getByRole('button', { name: 'example.com/services' }));
    expect(onOpen).toHaveBeenCalledWith('https://example.com/services');
  });

  it('calls onMove from the move button without toggling the group', () => {
    const onMove = vi.fn();
    render(
      <SourceGroupRow label='example.com/services' rootUrl='https://example.com/services' count={3} onMove={onMove}>
        <div>child-a</div>
      </SourceGroupRow>,
    );
    fireEvent.click(screen.getByLabelText('move example.com/services'));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('child-a')).not.toBeInTheDocument(); // still collapsed
  });

  it('calls onDelete from the delete button without toggling the group', () => {
    const onDelete = vi.fn();
    render(
      <SourceGroupRow label='example.com/services' rootUrl='https://example.com/services' count={3} onDelete={onDelete}>
        <div>child-a</div>
      </SourceGroupRow>,
    );
    fireEvent.click(screen.getByLabelText('delete example.com/services'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('child-a')).not.toBeInTheDocument(); // still collapsed
  });
});
