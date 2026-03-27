import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImageRenderer } from './ImageRenderer';

const closeTabMock = vi.hoisted(() => vi.fn());
const refreshTabUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../store', () => ({
  useFileViewerStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ closeTab: closeTabMock, refreshTabUrl: refreshTabUrlMock }),
}));

describe('ImageRenderer', () => {
  it('renders image and updates zoom controls', async () => {
    render(
      <ImageRenderer
        tab={{ id: 'img1', fileName: 'photo.png', mimeType: 'image/png', url: 'https://example.test/photo.png' }}
        isActive
      />,
    );

    const image = screen.getByRole('img', { name: 'photo.png' });
    fireEvent.load(image);

    expect(screen.getByText('100%')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');

    await userEvent.click(buttons[1]);
    expect(screen.getByText('125%')).toBeInTheDocument();

    await userEvent.click(buttons[0]);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows error state and supports retry/close', async () => {
    render(
      <ImageRenderer
        tab={{ id: 'img2', fileName: 'bad.png', mimeType: 'image/png', url: 'https://example.test/bad.png' }}
        isActive
      />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'bad.png' }));

    await waitFor(() => {
      expect(screen.getByText('image.error.title')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'actions.closeTab' }));
    expect(closeTabMock).toHaveBeenCalledWith('img2');

    await userEvent.click(screen.getByRole('button', { name: 'actions.retry' }));
    expect(refreshTabUrlMock).toHaveBeenCalledWith('img2');
  });
});
