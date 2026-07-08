import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const validateUrl = vi.fn();
const addPageLink = vi.fn();

vi.mock('../api', () => ({ validateUrl: (...a: unknown[]) => validateUrl(...a) }));
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) => sel({ addPageLink }),
}));

import { AddLinkDialog } from './AddLinkDialog';

describe('AddLinkDialog', () => {
  beforeEach(() => { validateUrl.mockReset(); addPageLink.mockReset(); });

  it('blocks submit on invalid URL format', async () => {
    render(<AddLinkDialog open onOpenChange={() => {}} workspaceId="ws1" />);
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: /lien/i }), { target: { value: 'not a url' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    expect(validateUrl).not.toHaveBeenCalled();
    expect(await screen.findByText(/URL valide/i)).toBeInTheDocument();
  });

  it('shows an error when the site is unreachable', async () => {
    validateUrl.mockResolvedValue({ reachable: false, error: 'timeout' });
    render(<AddLinkDialog open onOpenChange={() => {}} workspaceId="ws1" />);
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: /lien/i }), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    await waitFor(() => expect(validateUrl).toHaveBeenCalledWith('ws1', 'https://example.com'));
    expect(await screen.findByText(/injoignable/i)).toBeInTheDocument();
    expect(addPageLink).not.toHaveBeenCalled();
  });

  it('adds the link when reachable', async () => {
    validateUrl.mockResolvedValue({ reachable: true, status: 200 });
    addPageLink.mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<AddLinkDialog open onOpenChange={onOpenChange} workspaceId="ws1" />);
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: /lien/i }), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    await waitFor(() => expect(addPageLink).toHaveBeenCalledWith('ws1', 'https://example.com'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('does not double-submit when Enter is triggered twice in quick succession', async () => {
    validateUrl.mockResolvedValue({ reachable: true, status: 200 });
    addPageLink.mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<AddLinkDialog open onOpenChange={onOpenChange} workspaceId="ws1" />);
    await screen.findByRole('dialog');
    const input = screen.getByRole('textbox', { name: /lien/i });
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(addPageLink).toHaveBeenCalledWith('ws1', 'https://example.com'));
    expect(addPageLink).toHaveBeenCalledTimes(1);
  });
});
