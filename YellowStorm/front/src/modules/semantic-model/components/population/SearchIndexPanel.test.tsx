import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchIndexPanel } from './SearchIndexPanel';

vi.mock('./SearchIndexProgress', () => ({ SearchIndexProgress: () => <div>index-progress</div> }));

describe('SearchIndexPanel', () => {
  it('shows the index progress and stops a build that is running', () => {
    const onStop = vi.fn();
    render(<SearchIndexPanel modelId='model-1' building onClose={vi.fn()} onStop={onStop} />);

    expect(screen.getByText('index-progress')).toBeInTheDocument();
    expect(screen.getByText('runStatus.indexHint')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /runStop\.stop/ }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('says so when a stop takes long, and keeps the stop button disabled meanwhile', () => {
    render(<SearchIndexPanel modelId='model-1' building stopping onClose={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByText('runStatus.indexStoppingHint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /runStop\.stopping/ })).toBeDisabled();

    render(<SearchIndexPanel modelId='model-1' building stopping stoppingSlow onClose={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByText('runStatus.stoppingSlowHint')).toBeInTheDocument();
  });

  it('offers no stop once the build is over, and closes', () => {
    const onClose = vi.fn();
    render(<SearchIndexPanel modelId='model-1' building={false} onClose={onClose} onStop={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /runStop\.stop/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'action.close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
