import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const session = {
  status: 'idle' as string, frame: null as string | null, currentUrl: null as string | null,
  rootUrl: null as string | null,
  pages: [] as Array<{ url: string; title: string; linkText?: string }>, blockedNotice: null as string | null,
  start: vi.fn(), sendInput: vi.fn(), navigate: vi.fn(), stop: vi.fn(),
};
vi.mock('../hooks/useBrowserSession', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useBrowserSession')>('../hooks/useBrowserSession');
  return { ...actual, useBrowserSession: () => session };
});
const addPageLinks = vi.fn().mockResolvedValue(undefined);
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) =>
    sel({ addPageLinks, documents: [] }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AddLinkDialog } from './AddLinkDialog';

beforeEach(() => {
  session.status = 'idle'; session.pages = []; session.rootUrl = null; addPageLinks.mockClear();
  session.start.mockClear();
});

it('starts a browse session from the entered url', () => {
  render(<AddLinkDialog open onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.change(screen.getByPlaceholderText('https://exemple.com'), { target: { value: 'https://ok.example' } });
  fireEvent.click(screen.getByText('Naviguer'));
  expect(session.start).toHaveBeenCalledWith('https://ok.example');
});

it('indexes the selected pages under the session root url', async () => {
  session.status = 'live';
  session.rootUrl = 'https://ok.example/start';
  session.pages = [{ url: 'https://ok.example/a', title: 'A' }, { url: 'https://ok.example/b', title: 'B' }];
  const onOpenChange = vi.fn();
  render(<AddLinkDialog open onOpenChange={onOpenChange} workspaceId='w1' />);
  fireEvent.click(screen.getByRole('button', { name: /Indexer/ }));
  await waitFor(() =>
    expect(addPageLinks).toHaveBeenCalledWith(
      'w1',
      ['https://ok.example/a', 'https://ok.example/b'],
      expect.objectContaining({ sourceRootUrl: 'https://ok.example/start' }),
    ),
  );
});

it('sends the clicked link text as each page name', async () => {
  session.status = 'live';
  session.pages = [
    { url: 'https://ok.example/a', title: 'A Title', linkText: 'About Us' },
    { url: 'https://ok.example/b', title: 'B Title' },
  ];
  render(<AddLinkDialog open onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.click(screen.getByRole('button', { name: /Indexer/ }));
  await waitFor(() =>
    expect(addPageLinks).toHaveBeenCalledWith(
      'w1',
      ['https://ok.example/a', 'https://ok.example/b'],
      expect.objectContaining({ names: { 'https://ok.example/a': 'About Us', 'https://ok.example/b': 'B Title' } }),
    ),
  );
});
