import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const crawlUrl = vi.fn();
const addPageLinks = vi.fn();

vi.mock('../api', () => ({ crawlUrl: (...a: unknown[]) => crawlUrl(...a) }));
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) => sel({ addPageLinks }),
}));

import { AddLinkDialog } from './AddLinkDialog';

describe('AddLinkDialog', () => {
  beforeEach(() => { crawlUrl.mockReset(); addPageLinks.mockReset(); });

  it('blocks crawl on invalid URL format', async () => {
    render(<AddLinkDialog open onOpenChange={() => {}} workspaceId="ws1" />);
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: /lien/i }), { target: { value: 'not a url' } });
    fireEvent.click(screen.getByRole('button', { name: /cartographier/i }));
    expect(crawlUrl).not.toHaveBeenCalled();
    expect(await screen.findByText(/URL valide/i)).toBeInTheDocument();
  });

  it('shows an error when the site is unreachable', async () => {
    crawlUrl.mockResolvedValue({ tree: [], truncated: false, unreachable: true });
    render(<AddLinkDialog open onOpenChange={() => {}} workspaceId="ws1" />);
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: /lien/i }), { target: { value: 'https://ex.com' } });
    fireEvent.click(screen.getByRole('button', { name: /cartographier/i }));
    await waitFor(() => expect(crawlUrl).toHaveBeenCalledWith('ws1', 'https://ex.com'));
    expect(await screen.findByText(/injoignable/i)).toBeInTheDocument();
  });

  it('crawls, shows the tree, and adds selected pages', async () => {
    crawlUrl.mockResolvedValue({ truncated: false, tree: [
      { url: 'https://ex.com/', path: '/', name: 'ex.com', alreadyIndexed: false, children: [
        { url: 'https://ex.com/a', path: '/a', name: 'a', alreadyIndexed: false, children: [] },
      ] },
    ] });
    addPageLinks.mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<AddLinkDialog open onOpenChange={onOpenChange} workspaceId="ws1" />);
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: /lien/i }), { target: { value: 'https://ex.com' } });
    fireEvent.click(screen.getByRole('button', { name: /cartographier/i }));
    // Tree appears; rows are labelled by page name. Root (ex.com) is pre-checked; add 'a' too.
    await screen.findByLabelText('a');
    fireEvent.click(screen.getByLabelText('a'));
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    await waitFor(() => expect(addPageLinks).toHaveBeenCalledWith(
      'ws1', expect.arrayContaining(['https://ex.com/', 'https://ex.com/a'])));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
