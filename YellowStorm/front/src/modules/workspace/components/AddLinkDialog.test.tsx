import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const session = {
  status: 'idle' as string, frame: null as string | null, currentUrl: null as string | null,
  rootUrl: null as string | null,
  pages: [] as Array<{ url: string; title: string; linkText?: string; manual?: boolean; indexingStatus?: string }>, blockedNotice: null as string | null,
  start: vi.fn(), sendInput: vi.fn(), navigate: vi.fn(), stop: vi.fn(),
  addManualPage: vi.fn().mockReturnValue(true), updatePage: vi.fn().mockReturnValue(true),
  addPages: vi.fn().mockReturnValue(2),
};
vi.mock('../hooks/useBrowserSession', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useBrowserSession')>('../hooks/useBrowserSession');
  return { ...actual, useBrowserSession: () => session };
});
const { crawlUrlMock } = vi.hoisted(() => ({
  crawlUrlMock: vi.fn().mockResolvedValue({ pages: [{ url: 'https://ok.example/docs/a' }], truncated: false }),
}));
vi.mock('../api', () => ({ crawlUrl: crawlUrlMock }));
let documentsCache: unknown = [];
let addLinkSeed: Array<{ url: string; name?: string; indexingStatus?: string }> = [];
const addPageLinks = vi.fn().mockResolvedValue(undefined);
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) =>
    sel({ addPageLinks, documents: documentsCache, addLinkDialog: { seed: addLinkSeed } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AddLinkDialog, migrateSelection } from './AddLinkDialog';

describe('migrateSelection', () => {
  it('moves the selection from the old url to the new url', () => {
    const result = migrateSelection(new Set(['https://a.com/x', 'https://b.com/y']), 'https://a.com/x', 'https://a.com/z');
    expect(result.has('https://a.com/x')).toBe(false);
    expect(result.has('https://a.com/z')).toBe(true);
    expect(result.has('https://b.com/y')).toBe(true);
  });

  it('leaves the set unchanged (same reference) when the old url was not selected', () => {
    const input = new Set(['https://b.com/y']);
    const result = migrateSelection(input, 'https://a.com/x', 'https://a.com/z');
    expect(result).toBe(input);
    expect(result.has('https://a.com/z')).toBe(false);
  });
});

beforeEach(() => {
  session.status = 'idle'; session.pages = []; session.rootUrl = null; addPageLinks.mockClear();
  session.start.mockClear();
  documentsCache = [];
  addLinkSeed = [];
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

it('indexes a manual different-domain link under the session root (no self-rooting)', async () => {
  session.status = 'live';
  session.rootUrl = 'https://ok.example/start';
  session.pages = [
    { url: 'https://ok.example/a', title: 'A' },
    { url: 'https://manual.org/p', title: '', linkText: 'Manual', manual: true },
  ];
  render(<AddLinkDialog open onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.click(screen.getByRole('button', { name: /Indexer/ }));
  await waitFor(() => expect(addPageLinks).toHaveBeenCalled());
  const opts = addPageLinks.mock.calls[0][2] as { sourceRootUrl?: string; roots?: unknown };
  expect(opts.sourceRootUrl).toBe('https://ok.example/start'); // every page shares the session root
  expect(opts.roots).toBeUndefined(); // manual links no longer self-root into their own group
});

it('auto-starts browsing when opened with autoStart and a valid url', () => {
  session.status = 'idle';
  render(<AddLinkDialog open autoStart initialUrl='https://ok.example/services' onOpenChange={vi.fn()} workspaceId='w1' />);
  expect(session.start).toHaveBeenCalledWith('https://ok.example/services', []);
  // browse phase — the input-phase URL field is gone
  expect(screen.queryByPlaceholderText('https://exemple.com')).not.toBeInTheDocument();
});

it('does not auto-start with an empty url (stays on the input phase)', () => {
  session.status = 'idle';
  render(<AddLinkDialog open autoStart initialUrl='' onOpenChange={vi.fn()} workspaceId='w1' />);
  expect(session.start).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText('https://exemple.com')).toBeInTheDocument();
});

it('seeds already-indexed pages and excludes them from indexing', async () => {
  session.status = 'live';
  session.rootUrl = 'https://ok.example';
  addLinkSeed = [{ url: 'https://ok.example/a', name: 'A', indexingStatus: 'ready' }];
  // the session (seeded via start) reports the seeded page plus a new browsed one
  session.pages = [
    { url: 'https://ok.example/a', title: '', linkText: 'A', indexingStatus: 'ready' },
    { url: 'https://ok.example/b', title: 'B' },
  ];
  render(<AddLinkDialog open autoStart initialUrl='https://ok.example' onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.click(screen.getByRole('button', { name: /Indexer/ }));
  await waitFor(() =>
    expect(addPageLinks).toHaveBeenCalledWith('w1', ['https://ok.example/b'], expect.anything()),
  );
});

it('explores a link and adds the discovered pages', async () => {
  session.status = 'live';
  session.pages = [{ url: 'https://ok.example/docs', title: 'Docs' }];
  render(<AddLinkDialog open onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.click(screen.getByLabelText('explore https://ok.example/docs'));
  await waitFor(() => expect(crawlUrlMock).toHaveBeenCalledWith('w1', 'https://ok.example/docs'));
  await waitFor(() => expect(session.addPages).toHaveBeenCalled());
});

it('indexes an already-indexed url (clean slate allows duplicates)', async () => {
  session.status = 'live';
  session.rootUrl = 'https://ok.example/start';
  session.pages = [{ url: 'https://ok.example/a', title: 'A' }];
  // Simulate the page already existing in the workspace cache — old behavior filtered it out.
  documentsCache = new Map([[1, [{ id: 'd1', sourceUrl: 'https://ok.example/a' }]]]);
  render(<AddLinkDialog open onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.click(screen.getByRole('button', { name: /Indexer/ }));
  await waitFor(() =>
    expect(addPageLinks).toHaveBeenCalledWith('w1', ['https://ok.example/a'], expect.anything()),
  );
});
