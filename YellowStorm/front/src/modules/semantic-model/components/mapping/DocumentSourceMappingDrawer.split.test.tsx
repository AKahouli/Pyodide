import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { SemanticGraph } from '../../types';
import { DocumentSourceMappingDrawer } from './DocumentSourceMappingDrawer';

const api = vi.hoisted(() => ({
  listSourceAssets: vi.fn(),
  listSourceMappings: vi.fn(),
  previewSourceMapping: vi.fn(),
  getDocumentLabels: vi.fn(),
}));
vi.mock('../../api', () => ({ semanticModelApi: api }));
vi.mock('@/modules/workspace/api', () => ({ getDocuments: vi.fn(), getFolderContents: vi.fn(), getDocument: vi.fn() }));
// The real viewer loads the file; here it only shows where it was asked to go.
vi.mock('@/modules/file-viewer/components/DocumentPreviewViewer', () => ({
  DocumentPreviewViewer: ({ fileName, navigation }: { fileName: string; navigation?: { page?: number; highlightText?: string } | null }) =>
    <div data-testid='viewer'>{fileName}|{navigation?.page ?? ''}|{navigation?.highlightText ?? ''}</div>,
}));

const graph: SemanticGraph = {
  modelId: 'model-1', versionId: 'version-1', revision: 0, relations: [], records: [], recordRelations: [],
  nodes: [{ id: 'concept-1', key: 'contract', label: 'Contract', description: '', category: 'business_object', recordPolicy: 'none', systemKey: null, aliases: [], attributes: [
    { key: 'contract_number', label: 'Contract number', type: 'text', required: true },
    { key: 'amendment_number', label: 'Amendment number', type: 'text', required: true },
  ], position: { x: 0, y: 0 } }],
};
const longQuote = `Contract number CNT-1 ${'and a long passage that goes on '.repeat(10)}`;
const reading = (documentStatus = 'read') => ({
  entities: [], stats: { scannedRows: 1, resolvedEntities: 0, duplicateKeysSkipped: 0, nullIdentitySkipped: 0 }, identityEvidence: [], warnings: [], documentStatus,
  fields: {
    contract_number: { method: 'rules', reason: 'found', value: 'CNT-1', page: 3, pageEnd: 4, quote: longQuote },
    amendment_number: { method: 'rules', reason: 'label_not_found' },
  },
});

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><DocumentSourceMappingDrawer modelId='model-1' target={{
    workspaceId: 'workspace-1', documentId: 'document-1', documentName: 'One.pdf', assetKind: 'document', conceptId: 'concept-1', mimeType: 'application/pdf', path: 'one.pdf',
  }} onClose={vi.fn()} /></QueryClientProvider>);
}

describe('DocumentSourceMappingDrawer, document beside the fields', () => {
  const matchMedia = globalThis.matchMedia;
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('semantic-model.document-split');
    useSemanticModelEditorStore.getState().hydrate(graph);
    api.listSourceMappings.mockResolvedValue([]);
    api.listSourceAssets.mockResolvedValue({ assets: [
      { workspaceId: 'workspace-1', documentId: 'document-1', name: 'One.pdf', kind: 'document', mimeType: 'application/pdf', path: 'one.pdf' },
      { workspaceId: 'workspace-1', documentId: 'document-2', name: 'Two.pdf', kind: 'document', mimeType: 'application/pdf', path: 'two.pdf' },
    ] });
    api.previewSourceMapping.mockResolvedValue(reading());
    api.getDocumentLabels.mockResolvedValue({ documentsRead: 1, unread: [], labels: [{ label: 'Contract No.', kind: 'label', documents: 1, page: 2, example: 'Contract No.: CNT-1' }] });
  });
  afterEach(() => { globalThis.matchMedia = matchMedia; });

  it('shows the document, switches between documents and hides it on request', async () => {
    renderDrawer();
    expect(await screen.findByTestId('viewer')).toHaveTextContent('One.pdf');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Two.pdf' }));
    const header = screen.getByRole('toolbar', { name: 'mapping.live.switcher' });
    expect(within(header).getByText('mapping.live.position')).toBeInTheDocument();
    fireEvent.keyDown(within(header).getByRole('button', { name: 'mapping.live.next' }), { key: 'ArrowRight' });
    expect(screen.getByTestId('viewer')).toHaveTextContent('Two.pdf');
    fireEvent.click(within(header).getByRole('button', { name: 'mapping.live.previous' }));
    expect(screen.getByTestId('viewer')).toHaveTextContent('One.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'mapping.live.hideDocument' }));
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('semantic-model.document-split')!)).toMatchObject({ collapsed: true });
    fireEvent.click(screen.getByRole('button', { name: 'mapping.live.showDocument' }));
    expect(screen.getByTestId('viewer')).toBeInTheDocument();
  });

  it('uses tabs instead of the split on narrow screens', async () => {
    globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderDrawer();
    const documentTab = await screen.findByRole('tab', { name: /mapping\.live\.documentTab/ });
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'mapping.live.hideDocument' })).not.toBeInTheDocument();
    fireEvent.mouseDown(documentTab, { button: 0 });
    expect(await screen.findByTestId('viewer')).toHaveTextContent('One.pdf');
  });

  it('reads the shown document with the current rules, once the edits settle', async () => {
    renderDrawer();
    await waitFor(() => expect(api.previewSourceMapping).toHaveBeenCalledTimes(1));
    expect(api.previewSourceMapping).toHaveBeenLastCalledWith('model-1', expect.objectContaining({ documentId: 'document-1', assetKind: 'document' }));

    // What was found, with its pages; showing it scrolls the viewer and highlights the start of the passage.
    expect(await screen.findByText('CNT-1')).toBeInTheDocument();
    expect(screen.getByText('mapping.reading.pages')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.live.show' }));
    const shown = screen.getByTestId('viewer').textContent!.split('|');
    expect(shown[1]).toBe('3');
    expect(shown[2].length).toBeLessThanOrEqual(120);
    expect(longQuote.startsWith(shown[2])).toBe(true);
    // What was not found offers to look for its label.
    expect(screen.getByText('mapping.reading.reason.label_not_found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mapping\.live\.findLabel/ }));
    expect(screen.getByTestId('viewer')).toHaveTextContent('One.pdf||Amendment number');

    // Two quick edits read the document once more, not twice.
    const ruleToggles = screen.getAllByRole('button', { name: /mapping\.rules\.title/ });
    fireEvent.click(ruleToggles[0]);
    const input = screen.getByPlaceholderText('Contract number');
    fireEvent.change(input, { target: { value: 'N°' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    fireEvent.change(screen.getByPlaceholderText('mapping.rules.addLabel'), { target: { value: 'Ref' } });
    fireEvent.keyDown(screen.getByPlaceholderText('mapping.rules.addLabel'), { key: 'Enter' });
    await waitFor(() => expect(api.previewSourceMapping).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(api.previewSourceMapping).toHaveBeenCalledTimes(2);
    expect(api.previewSourceMapping).toHaveBeenLastCalledWith('model-1', expect.objectContaining({
      fieldMappings: expect.arrayContaining([expect.objectContaining({ targetAttribute: 'contract_number', rules: { labels: ['N°', 'Ref'] } })]),
    }));
    // Labels found across the documents are offered under the labels.
    expect(screen.getByRole('button', { name: 'mapping.suggestions.add' })).toHaveTextContent('Contract No.');
    expect(api.getDocumentLabels).toHaveBeenCalledWith('model-1', { workspaceId: 'workspace-1', documentIds: ['document-1'] });
  });

  it('ignores an answer that arrives after a newer one was asked for', async () => {
    let finishFirst!: (value: object) => void;
    api.previewSourceMapping.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    renderDrawer();
    await waitFor(() => expect(api.previewSourceMapping).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole('button', { name: /mapping\.rules\.title/ })[0]);
    const input = screen.getByPlaceholderText('Contract number');
    fireEvent.change(input, { target: { value: 'N°' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.previewSourceMapping).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(await screen.findByText('CNT-1')).toBeInTheDocument();
    finishFirst({ ...reading(), fields: { contract_number: { method: 'rules', reason: 'found', value: 'OLD-1', page: 1 } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('OLD-1')).not.toBeInTheDocument();
  });

  it('says plainly when the document cannot be read', async () => {
    api.previewSourceMapping.mockResolvedValue(reading('index_unavailable'));
    renderDrawer();
    expect(await screen.findByText('mapping.live.status.index_unavailable')).toBeInTheDocument();
  });
});
