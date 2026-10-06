import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticModelGraphViewer } from './SemanticModelGraphViewer';

const apiMocks = vi.hoisted(() => ({
  getGraphOutline: vi.fn(),
  getGraphRecord: vi.fn(),
  searchGraph: vi.fn(),
  exportGraph: vi.fn(),
  graph: vi.fn(),
  listCorrections: vi.fn(),
}));
const exportMocks = vi.hoisted(() => ({ buildExportHtml: vi.fn() }));

vi.mock('../../api', () => ({ semanticModelApi: apiMocks }));
vi.mock('../graph/graph-export', () => exportMocks);
// jsdom draws no WebGL: the canvas is stood in for by one button per thing drawn.
vi.mock('../graph/GraphCanvas', async () => {
  const React = await import('react');
  return {
    GraphCanvas: React.forwardRef(function FakeCanvas(props: { nodes: Array<{ id: string; label: string; concept: string }>; onSelect: (id: string) => void }, ref) {
      React.useImperativeHandle(ref, () => ({ fit: vi.fn(), centerOn: vi.fn() }));
      return <div data-testid='canvas'>{props.nodes.map((item) => <button key={item.id} type='button' aria-label={`${item.label} · ${item.concept}`} onClick={() => props.onSelect(item.id)} />)}</div>;
    }),
  };
});

const LONG = 'Bonjour, '.repeat(40);
const VALUES: Record<string, Record<string, unknown>> = {
  m1: { sujet: 'Hello', corps: LONG, cle_message: null },
  m2: { sujet: 'Invoice', corps: 'Short', cle_message: 'k2' },
  p1: { nom: 'Ana' },
};
const graph = {
  dataRevisionId: 'rev-9',
  concepts: [{ id: 'c-mail', fields: ['sujet', 'corps', 'cle_message'] }, { id: 'c-person', fields: ['nom'] }],
  records: [
    { id: 'm1', c: 'c-mail', l: 'Hello', m: ['cle_message'] },
    { id: 'm2', c: 'c-mail', l: 'Invoice' },
    { id: 'p1', c: 'c-person', l: 'Ana' },
  ],
  links: [{ id: 'e1', r: 'r-sent', s: 'm1', t: 'p1' }, { id: 'e2', r: 'r-sent', s: 'm2', t: 'p1' }],
};
const structure = {
  nodes: [
    { id: 'c-mail', key: 'mail', label: 'Message', attributes: [{ key: 'sujet', label: 'Subject', type: 'text' }, { key: 'corps', label: 'Body', type: 'text' }, { key: 'cle_message', label: 'Message key', type: 'text' }] },
    { id: 'c-person', key: 'person', label: 'Correspondent', attributes: [{ key: 'nom', label: 'Name', type: 'text' }] },
  ],
  relations: [{ id: 'r-sent', key: 'sent', label: 'sent by' }],
  records: [], recordRelations: [],
};

function renderViewer(props: Partial<React.ComponentProps<typeof SemanticModelGraphViewer>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SemanticModelGraphViewer open onClose={vi.fn()} modelId="model-1" {...props} /></QueryClientProvider>);
}

async function pick(user: ReturnType<typeof userEvent.setup>, text: string, name: RegExp) {
  await user.type(screen.getByRole('textbox', { name: 'graphViewer.search' }), text);
  await user.click(within(screen.getByRole('listbox', { name: 'graphViewer.searchResults' })).getByRole('button', { name }));
}

describe('SemanticModelGraphViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getGraphOutline.mockResolvedValue({ concepts: [], records: [], links: [] });
    apiMocks.getGraphRecord.mockImplementation(async (_model: string, id: string) => ({ id, values: VALUES[id], sourceFileName: null }));
    apiMocks.searchGraph.mockResolvedValue({ hits: [] });
    apiMocks.graph.mockResolvedValue({ nodes: [], relations: [], records: [], recordRelations: [] });
    apiMocks.listCorrections.mockResolvedValue({ corrections: [] });
  });

  it('refreshes the runtime graph without exposing graph mutations', async () => {
    const user = userEvent.setup();
    renderViewer();
    await waitFor(() => expect(apiMocks.getGraphOutline).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'graphViewer.refresh' }));

    await waitFor(() => expect(apiMocks.getGraphOutline).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'graphViewer.addNode' })).not.toBeInTheDocument();
  });

  it('reads the requested data revision', async () => {
    renderViewer({ dataRevisionId: 'rev-1' });
    await waitFor(() => expect(apiMocks.getGraphOutline).toHaveBeenCalledWith('model-1', 'rev-1'));
  });

  it('opens on one bubble per concept when there are too many records to draw', async () => {
    window.localStorage.removeItem('semantic-model.graph.drawLimit');
    const records = Array.from({ length: 1501 }, (_, position) => ({ id: `m${position}`, c: 'c-mail', l: `Mail ${position}` }));
    apiMocks.getGraphOutline.mockResolvedValue({ concepts: [{ id: 'c-mail', fields: [] }], records, links: [] });
    apiMocks.graph.mockResolvedValue({ nodes: [{ id: 'c-mail', key: 'mail', label: 'Message', attributes: [] }], relations: [], records: [], recordRelations: [] });
    const user = userEvent.setup();
    renderViewer();
    expect(await screen.findByRole('note')).toHaveTextContent('graphViewer.tooManyToDraw');
    expect(within(screen.getByTestId('canvas')).getAllByRole('button')).toHaveLength(1);

    // A higher limit, kept in this browser, draws them all.
    const limit = screen.getByRole('spinbutton', { name: 'graphViewer.drawLimit' });
    await user.clear(limit);
    await user.type(limit, '2000{Enter}');
    await waitFor(() => expect(within(screen.getByTestId('canvas')).getAllByRole('button')).toHaveLength(1501));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('semantic-model.graph.drawLimit')).toBe('2000');
    window.localStorage.removeItem('semantic-model.graph.drawLimit');
  });

  describe('with records', () => {
    beforeEach(() => {
      apiMocks.getGraphOutline.mockResolvedValue(graph);
      apiMocks.graph.mockResolvedValue(structure);
    });

    it('finds a record and shows its values by their names, long ones folded and missing ones apart', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Hello · mail' });
      await pick(user, 'hel', /Hello/);

      const panel = screen.getByRole('complementary', { name: 'graphViewer.recordPanel' });
      expect(within(panel).getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
      expect(await within(panel).findByText('Subject')).toBeInTheDocument();
      expect(apiMocks.getGraphRecord).toHaveBeenCalledWith('model-1', 'm1', 'rev-9');
      expect(within(panel).queryByText('sujet')).not.toBeInTheDocument();
      // The long body shows three lines and opens on demand.
      expect(within(panel).getByText(LONG.trimEnd(), { normalizer: (text) => text.trim() })).toHaveClass('line-clamp-3');
      await user.click(within(panel).getByRole('button', { name: 'graphViewer.showMore' }));
      expect(within(panel).getByText(LONG.trimEnd(), { normalizer: (text) => text.trim() })).not.toHaveClass('line-clamp-3');
      // The missing key is folded below the values.
      expect(within(panel).queryByText('Message key')).not.toBeInTheDocument();
      await user.click(within(panel).getByRole('button', { name: 'graphViewer.missingCount' }));
      expect(within(panel).getByText('Message key')).toBeInTheDocument();
    });

    it('lists linked records by relationship and moves to one', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Ana · person' });
      await pick(user, 'ana', /Ana/);
      const linked = screen.getByRole('region', { name: 'graphViewer.linked' });
      expect(within(linked).getByRole('button', { name: /sent by.*2 Message/ })).toBeInTheDocument();
      await user.click(within(linked).getByRole('button', { name: 'Invoice' }));
      expect(screen.getByRole('heading', { name: 'Invoice' })).toBeInTheDocument();
    });

    it('fixes a value from its own line when editing is allowed', async () => {
      const user = userEvent.setup();
      renderViewer({ canEdit: true });
      await screen.findByRole('button', { name: 'Hello · mail' });
      await pick(user, 'hel', /Hello/);
      const panel = screen.getByRole('complementary', { name: 'graphViewer.recordPanel' });
      expect((await within(panel).findAllByRole('button', { name: 'corrections.fixValueOf' })).length).toBe(2);
      expect(within(panel).getByRole('button', { name: 'corrections.hideRecord' })).toBeInTheDocument();
    });

    it('hides and shows a concept from the legend', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Ana · person' });
      const legend = screen.getByRole('group', { name: 'graphViewer.legend' });
      await user.click(within(legend).getByRole('button', { name: /Correspondent/ }));
      expect(screen.queryByRole('button', { name: 'Ana · person' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hello · mail' })).toBeInTheDocument();
      await user.click(within(legend).getByRole('button', { name: 'graphViewer.showAll' }));
      expect(await screen.findByRole('button', { name: 'Ana · person' })).toBeInTheDocument();
    });

    it('shows figures in the overview and how two records are connected', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Ana · person' });
      await user.click(screen.getByRole('button', { name: /graphViewer.overview/ }));
      const overview = screen.getByRole('complementary', { name: 'graphViewer.overview' });
      expect(within(overview).getByRole('button', { name: /Message\s*2/ })).toBeInTheDocument();

      await user.click(within(overview).getByRole('button', { name: /graphViewer.path/ }));
      await user.type(within(overview).getByRole('textbox', { name: 'graphViewer.pathFrom' }), 'hello');
      await user.click(within(overview).getByRole('button', { name: /Hello/ }));
      await user.type(within(overview).getByRole('textbox', { name: 'graphViewer.pathTo' }), 'invoice');
      await user.click(within(overview).getByRole('button', { name: /Invoice.*Message/ }));
      expect(within(overview).getByText(/↓ sent by/)).toBeInTheDocument();
      expect(within(overview).getByText(/↑ sent by/)).toBeInTheDocument();
      await user.click(within(overview).getByRole('button', { name: 'graphViewer.showOnGraph' }));
      expect(within(overview).getByRole('status')).toHaveTextContent('graphViewer.pathFound');
    });

    it('finds a record by one of its values through the server', async () => {
      const user = userEvent.setup();
      apiMocks.searchGraph.mockResolvedValue({ hits: [{ id: 'm2', field: 'corps', value: 'Short' }] });
      renderViewer();
      await screen.findByRole('button', { name: 'Hello · mail' });
      await user.type(screen.getByRole('textbox', { name: 'graphViewer.search' }), 'short');
      const results = screen.getByRole('listbox', { name: 'graphViewer.searchResults' });
      expect(await within(results).findByText('Body: Short')).toBeInTheDocument();
      expect(apiMocks.searchGraph).toHaveBeenCalledWith('model-1', 'short', 'rev-9');
    });

    it('exports the graph with the fields chosen, for owners and editors only', async () => {
      const user = userEvent.setup();
      exportMocks.buildExportHtml.mockResolvedValue(new Blob(['<html></html>'], { type: 'text/html' }));
      apiMocks.exportGraph.mockResolvedValue({ modelName: 'Mails', exportedBy: 'Ana', exportedAt: '2026-10-06T10:00:00Z', shortenTo: 200, records: [], links: [] });
      const createObjectURL = vi.fn(() => 'blob:graph');
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
      const { unmount } = renderViewer();
      await screen.findByRole('button', { name: 'Hello · mail' });
      expect(screen.queryByRole('button', { name: /graphViewer.export$/ })).not.toBeInTheDocument();
      unmount();

      renderViewer({ canExport: true });
      await screen.findByRole('button', { name: 'Hello · mail' });
      await user.click(screen.getByRole('button', { name: /graphViewer.export$/ }));
      const dialog = await screen.findByRole('dialog');
      // Every field starts in and shortened; the first one (Subject) is left out.
      await user.click(within(dialog).getAllByRole('checkbox', { name: 'graphViewer.exportInclude' })[0]);
      await user.click(within(dialog).getByRole('button', { name: /graphViewer.exportRun/ }));

      await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
      expect(apiMocks.exportGraph).toHaveBeenCalledWith('model-1', {
        dataRevisionId: 'rev-9', shortenTo: 200,
        fields: { 'c-mail': { sujet: 'exclude', corps: 'short', cle_message: 'short' }, 'c-person': { nom: 'short' } },
      });
    });
  });
});
