import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentPreviewViewer } from './DocumentPreviewViewer';

const client = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: client }));
vi.mock('../renderers', () => ({
  getRenderer: (mimeType: string) => mimeType === 'application/pdf'
    ? ({ tab, navigation }: { tab: { id: string; url: string }; navigation?: { tabId: string; page?: number; highlightText?: string } | null }) =>
      <div data-testid='renderer'>{tab.url}|{navigation?.tabId === tab.id ? `${navigation.page}:${navigation.highlightText}` : 'none'}</div>
    : null,
}));

const renderViewer = (navigation?: { page?: number; highlightText?: string; nonce: number }) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DocumentPreviewViewer workspaceId='workspace-1' documentId='document-1' fileName='One.pdf' mimeType='application/pdf' navigation={navigation} />
  </QueryClientProvider>,
);

describe('DocumentPreviewViewer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signs the document and hands the renderer its own navigation', async () => {
    client.get.mockResolvedValue({ data: { data: { url: 'https://files/one.pdf', expiresAt: new Date(Date.now() + 3_600_000).toISOString() } } });
    renderViewer({ page: 3, highlightText: 'Contract', nonce: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('One.pdf');
    expect(await screen.findByTestId('renderer')).toHaveTextContent('https://files/one.pdf|3:Contract');
    expect(client.get).toHaveBeenCalledWith(expect.stringContaining('document-1'));
  });

  it('says when the document cannot be opened', async () => {
    client.get.mockRejectedValue(new Error('gone'));
    renderViewer();
    expect(await screen.findByRole('alert')).toHaveTextContent('store.openError.title');
  });
});
