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
  get: vi.fn(),
  graph: vi.fn(),
  listCorrections: vi.fn(),
}));
const exportMocks = vi.hoisted(() => ({ buildExportHtml: vi.fn() }));
const viewExportMocks = vi.hoisted(() => ({ createViewExport: vi.fn() }));

vi.mock('../../api', () => ({ semanticModelApi: apiMocks }));
vi.mock('../graph/graph-export', () => exportMocks);
vi.mock('../../export/export-view', () => viewExportMocks);
// jsdom draws no WebGL: the canvas is stood in for by one button per thing drawn.
vi.mock('../graph/GraphCanvas', async () => {
  const React = await import('react');
  return {
    GraphCanvas: React.forwardRef(function FakeCanvas(props: {
      nodes: Array<{ id: string; label: string; concept: string; more?: number; moreLabel?: string; open?: boolean; info?: boolean }>;
      badgeLabels: { less: string; info: string }; busyId?: string | null;
      onSelect: (id: string) => void; onOpen: (id: string) => void; onExpand: (id: string) => void; onCollapse: (id: string) => void; onInfo: (id: string) => void;
    }, ref) {
      React.useImperativeHandle(ref, () => ({ fit: vi.fn(), centerOn: vi.fn(), positions: () => new Map([['m1', { x: 1, y: 2 }]]) }));
      return <div>
        <div data-testid='canvas'>{props.nodes.map((item) => <button key={item.id} type='button' aria-label={`${item.label} · ${item.concept}`} data-more={item.more} data-open={item.open || undefined} data-busy={props.busyId === item.id || undefined} title={item.moreLabel}
          onClick={() => props.onSelect(item.id)} onDoubleClick={() => props.onOpen(item.id)} />)}</div>
        <div data-testid='badges'>{props.nodes.flatMap((item) => [
          item.more ? <button key={`${item.id}+`} type='button' aria-label={`${item.moreLabel} · ${item.label}`} onClick={() => props.onExpand(item.id)} /> : null,
          item.open ? <button key={`${item.id}-`} type='button' aria-label={`${props.badgeLabels.less} · ${item.label}`} onClick={() => props.onCollapse(item.id)} /> : null,
          item.info ? <button key={`${item.id}i`} type='button' aria-label={`${props.badgeLabels.info} · ${item.label}`} onClick={() => props.onInfo(item.id)} /> : null,
        ])}</div>
      </div>;
    }),
  };
});

const LONG = 'Bonjour, '.repeat(40);
const VALUES: Record<string, Record<string, unknown>> = {
  m1: { sujet: 'Hello', corps: LONG, cle_message: null },
  m2: { sujet: 'Invoice', corps: 'Short', cle_message: 'k2' },
  p1: { nom: 'Ana' },
  m3: { sujet: 'Receipt' },
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

/** Opens the details of a record from its "i" badge: the panel stays closed until then. */
async function showDetails(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: `graphViewer.recordInfo · ${label}` }));
}

/** Opens the Export menu and chooses one of its entries. */
async function chooseExport(user: ReturnType<typeof userEvent.setup>, entry: string) {
  await user.click(screen.getByRole('button', { name: /graphViewer.export$/ }));
  await user.click(await screen.findByRole('menuitem', { name: entry }));
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

  it('shows source_documents metadata read-only in record details', async () => {
    apiMocks.getGraphOutline.mockResolvedValue(graph);
    apiMocks.graph.mockResolvedValue(structure);
    apiMocks.getGraphRecord.mockResolvedValue({ id: 'p1', values: VALUES.p1, sourceFileName: null,
      source_documents: [{ workspaceId: 'w1', documentId: 'd1', filename: 'a.eml' }] });
    const user = userEvent.setup();
    renderViewer({ canEdit: true });
    await screen.findByRole('button', { name: 'Ana · person' });
    await showDetails(user, 'Ana');
    const sources = await screen.findByRole('region', { name: 'sourceDocuments.title' });
    await waitFor(() => expect(sources).toHaveTextContent('workspaceId'));
    expect(sources).toHaveTextContent('documentId');
    expect(sources).toHaveTextContent('a.eml');
    expect(within(sources).getByRole('button', { name: 'graphViewer.copyValue' })).toBeInTheDocument();
    expect(within(sources).queryByRole('button', { name: /correction|fix|edit/i })).not.toBeInTheDocument();
  });

  it('opens as a centred window that closes from its backdrop', async () => {
    const onClose = vi.fn();
    renderViewer({ modal: true, onClose });
    const dialog = await screen.findByRole('dialog', { name: 'graphViewer.title' });
    await userEvent.setup().click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.setup().click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reads the requested data revision', async () => {
    renderViewer({ dataRevisionId: 'rev-1' });
    await waitFor(() => expect(apiMocks.getGraphOutline).toHaveBeenCalledWith('model-1', 'rev-1', undefined));
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

  describe('a large graph read in part', () => {
    const part = {
      dataRevisionId: 'rev-9', truncated: true, nodeLimit: 2000,
      totals: { records: 125900, links: 225500, concepts: { 'c-mail': 120000, 'c-person': 5900 }, relations: { 'r-sent': 225500 } },
      concepts: graph.concepts,
      records: [{ id: 'm1', c: 'c-mail', l: 'Hello' }, { id: 'p1', c: 'c-person', l: 'Ana' }],
      links: [{ id: 'e1', r: 'r-sent', s: 'm1', t: 'p1' }],
    };
    beforeEach(() => {
      apiMocks.getGraphOutline.mockResolvedValue(part);
      apiMocks.graph.mockResolvedValue(structure);
    });

    it('says how many of the records are shown and offers the concepts to read', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Hello · mail' });
      expect(screen.getByText('graphViewer.windowShowing')).toBeInTheDocument();
      const picker = screen.getByRole('combobox', { name: /graphViewer.loadConcept/ });
      expect(within(picker).getAllByRole('option')).toHaveLength(3);

      await user.selectOptions(picker, 'c-person');
      await waitFor(() => expect(apiMocks.getGraphOutline).toHaveBeenLastCalledWith('model-1', undefined, { conceptId: 'c-person' }));
    });

    it('does not search the values of a graph it holds only in part, nor export it', async () => {
      const user = userEvent.setup();
      renderViewer({ canExport: true });
      await screen.findByRole('button', { name: 'Hello · mail' });
      await user.type(screen.getByRole('textbox', { name: 'graphViewer.search' }), 'short');
      expect(apiMocks.searchGraph).not.toHaveBeenCalled();
      // The whole graph is too large to export from here; the records read still can be.
      await user.click(screen.getByRole('button', { name: /graphViewer.export$/ }));
      expect(await screen.findByRole('menuitem', { name: 'graphViewer.exportWhole' })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('menuitem', { name: 'graphViewer.exportView' })).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('adds the neighbours of the selected record to the graph', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Hello · mail' });
      const load = screen.getByRole('button', { name: 'graphViewer.loadNeighbours' });
      expect(load).toBeDisabled();

      apiMocks.getGraphOutline.mockResolvedValueOnce({
        dataRevisionId: 'rev-9', truncated: false, nodeLimit: 2000, totals: null, concepts: graph.concepts,
        records: [{ id: 'p1', c: 'c-person', l: 'Ana' }, { id: 'm2', c: 'c-mail', l: 'Invoice' }],
        links: [{ id: 'e2', r: 'r-sent', s: 'm2', t: 'p1' }],
      });
      await pick(user, 'ana', /Ana/);
      await user.click(load);
      expect(await screen.findByRole('button', { name: 'Invoice · mail' })).toBeInTheDocument();
      expect(apiMocks.getGraphOutline).toHaveBeenLastCalledWith('model-1', 'rev-9', { focus: 'p1' });
      // What was shown stays, and the totals of the whole graph are kept.
      expect(screen.getByRole('button', { name: 'Hello · mail' })).toBeInTheDocument();
      expect(screen.getByText('graphViewer.windowShowing')).toBeInTheDocument();
    });

    it('reads a record a chat citation names when it was not among those read first', async () => {
      const found = vi.fn();
      apiMocks.getGraphOutline.mockResolvedValueOnce(part).mockResolvedValueOnce({
        dataRevisionId: 'rev-9', truncated: false, nodeLimit: 2000, totals: null, concepts: graph.concepts,
        records: [{ id: 'm2', c: 'c-mail', l: 'Invoice' }, { id: 'p1', c: 'c-person', l: 'Ana' }],
        links: [{ id: 'e2', r: 'r-sent', s: 'm2', t: 'p1' }],
      });
      renderViewer({ initialRecordId: 'm2', onInitialRecord: found });
      const panel = await screen.findByRole('complementary', { name: 'graphViewer.recordPanel' });
      expect(within(panel).getByRole('heading', { name: 'Invoice' })).toBeInTheDocument();
      expect(apiMocks.getGraphOutline).toHaveBeenLastCalledWith('model-1', 'rev-9', { focus: 'm2' });
      expect(found).toHaveBeenCalledWith(true);
    });

    describe('exploring by double-click', () => {
      // Two records are unlinked to m1 and stay out of its neighbourhood; m1 has links to unread records (n: 4, one read).
      const explorable = {
        ...part,
        concepts: graph.concepts,
        records: [{ id: 'm1', c: 'c-mail', l: 'Hello', n: 4 }, { id: 'p1', c: 'c-person', l: 'Ana', n: 2 }, { id: 'p9', c: 'c-person', l: 'Zoe', n: 0 }],
        links: [{ id: 'e1', r: 'r-sent', s: 'm1', t: 'p1' }],
      };
      const around = {
        dataRevisionId: 'rev-9', truncated: false, nodeLimit: 5000, totals: null, concepts: graph.concepts,
        records: [{ id: 'm1', c: 'c-mail', l: 'Hello', n: 4 }, { id: 'p1', c: 'c-person', l: 'Ana', n: 2 }, { id: 'm2', c: 'c-mail', l: 'Invoice', n: 2 }, { id: 'm3', c: 'c-mail', l: 'Receipt', n: 1 }],
        links: [{ id: 'e1', r: 'r-sent', s: 'm1', t: 'p1' }, { id: 'e2', r: 'r-sent', s: 'm2', t: 'p1' }, { id: 'e3', r: 'r-sent', s: 'm3', t: 'm2' }],
      };
      beforeEach(() => { apiMocks.getGraphOutline.mockResolvedValue(explorable); });

      it('marks the records that have links not read yet, and only those', async () => {
        renderViewer();
        const hello = await screen.findByRole('button', { name: 'Hello · mail' });
        expect(hello).toHaveAttribute('data-more', '3');
        expect(hello).toHaveAttribute('title', 'graphViewer.moreLinks');
        expect(screen.getByRole('button', { name: 'Ana · person' })).toHaveAttribute('data-more', '1');
        expect(screen.getByRole('button', { name: 'Zoe · person' })).not.toHaveAttribute('data-more');
      });

      const open = async (user: ReturnType<typeof userEvent.setup>, name: string) => user.dblClick(screen.getByRole('button', { name }));

      it('reads the record 2 links away by default, adds it to the graph and shows only that neighbourhood', async () => {
        const user = userEvent.setup();
        renderViewer();
        await screen.findByRole('button', { name: 'Hello · mail' });
        apiMocks.getGraphOutline.mockResolvedValueOnce(around);
        await open(user, 'Hello · mail');

        expect(await screen.findByRole('button', { name: 'Invoice · mail' })).toBeInTheDocument();
        expect(apiMocks.getGraphOutline).toHaveBeenLastCalledWith('model-1', 'rev-9', { focus: 'm1', depth: 2, limit: 5000 });
        // The record is selected; what is not near it (or too far) is left out; the totals of the whole graph are kept.
        expect(screen.queryByRole('complementary', { name: 'graphViewer.recordPanel' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Zoe · person' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Receipt · mail' })).not.toBeInTheDocument();
        expect(screen.getByText('graphViewer.windowShowing')).toBeInTheDocument();
        expect(screen.getByText('graphViewer.focusOn')).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: /graphViewer.focus/ })).toHaveValue('2');
        expect(screen.queryByText('graphViewer.exploreCapped')).not.toBeInTheDocument();
      });

      it('goes as deep as the Focus select says, and reads again when it changes', async () => {
        const user = userEvent.setup();
        renderViewer();
        await screen.findByRole('button', { name: 'Hello · mail' });
        await user.click(screen.getByRole('button', { name: 'Hello · mail' }));
        const focus = screen.getByRole('combobox', { name: /graphViewer.focus/ });
        expect(within(focus).getAllByRole('option')).toHaveLength(9);

        apiMocks.getGraphOutline.mockResolvedValueOnce(around);
        await user.selectOptions(focus, '3');
        await waitFor(() => expect(apiMocks.getGraphOutline).toHaveBeenLastCalledWith('model-1', 'rev-9', { focus: 'm1', depth: 3, limit: 5000 }));
        expect(await screen.findByRole('button', { name: 'Receipt · mail' })).toBeInTheDocument();

        // The depth chosen is the one a double-click uses.
        apiMocks.getGraphOutline.mockResolvedValueOnce({ ...around, records: [{ id: 'p9', c: 'c-person', l: 'Zoe', n: 0 }], links: [] });
        await open(user, 'Ana · person');
        await waitFor(() => expect(apiMocks.getGraphOutline).toHaveBeenLastCalledWith('model-1', 'rev-9', { focus: 'p1', depth: 3, limit: 5000 }));
      });

      it('shows that it is reading, over the graph and on the bubble, then why it could not', async () => {
        const user = userEvent.setup();
        renderViewer();
        await screen.findByRole('button', { name: 'Hello · mail' });
        let fail: (error: Error) => void = () => undefined;
        apiMocks.getGraphOutline.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
        await open(user, 'Hello · mail');
        expect(await screen.findByText('graphViewer.exploring')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Hello · mail' })).toHaveAttribute('data-busy', 'true');
        expect(screen.getByRole('button', { name: 'Ana · person' })).not.toHaveAttribute('data-busy');

        fail(new Error('The semantic runtime did not answer in time'));
        expect(await screen.findByRole('alert')).toHaveTextContent('graphViewer.loadNeighboursFailed');
        await waitFor(() => expect(screen.queryByText('graphViewer.exploring')).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Hello · mail' })).not.toHaveAttribute('data-busy');
      });

      it('opens a neighbour from where it is, then closes it again with a double-click, bringing back its badge', async () => {
        const user = userEvent.setup();
        renderViewer();
        await screen.findByRole('button', { name: 'Hello · mail' });
        apiMocks.getGraphOutline.mockResolvedValueOnce(around);
        await open(user, 'Hello · mail');
        const invoice = await screen.findByRole('button', { name: 'Invoice · mail' });
        expect(invoice).toHaveAttribute('data-more', '1');

        apiMocks.getGraphOutline.mockResolvedValueOnce({
          ...around, records: [{ id: 'm2', c: 'c-mail', l: 'Invoice', n: 2 }, { id: 'm3', c: 'c-mail', l: 'Receipt', n: 1 }], links: [{ id: 'e3', r: 'r-sent', s: 'm3', t: 'm2' }],
        });
        await open(user, 'Invoice · mail');
        expect(await screen.findByRole('button', { name: 'Receipt · mail' })).toBeInTheDocument();
        expect(apiMocks.getGraphOutline).toHaveBeenLastCalledWith('model-1', 'rev-9', { focus: 'm2', depth: 2, limit: 5000 });
        expect(screen.getByRole('button', { name: 'Hello · mail' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Invoice · mail' })).not.toHaveAttribute('data-more');
        const reads = apiMocks.getGraphOutline.mock.calls.length;

        // Closing it hides what only it showed; what is read stays read, so nothing is fetched.
        await open(user, 'Invoice · mail');
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Receipt · mail' })).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Invoice · mail' })).toHaveAttribute('data-more', '1');
        expect(screen.getByRole('button', { name: 'Hello · mail' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Zoe · person' })).not.toBeInTheDocument();
        expect(apiMocks.getGraphOutline).toHaveBeenCalledTimes(reads);
      });

      it('closing a record also closes what was opened from inside it, back to its direct links', async () => {
        const user = userEvent.setup();
        renderViewer();
        await screen.findByRole('button', { name: 'Hello · mail' });
        apiMocks.getGraphOutline.mockResolvedValueOnce(around);
        await open(user, 'Hello · mail');
        await screen.findByRole('button', { name: 'Invoice · mail' });
        apiMocks.getGraphOutline.mockResolvedValueOnce({ ...around, records: [{ id: 'm3', c: 'c-mail', l: 'Receipt', n: 1 }, { id: 'm2', c: 'c-mail', l: 'Invoice', n: 2 }], links: [{ id: 'e3', r: 'r-sent', s: 'm3', t: 'm2' }] });
        await open(user, 'Invoice · mail');
        await screen.findByRole('button', { name: 'Receipt · mail' });

        await open(user, 'Hello · mail');
        // Nothing opened any more: Hello folds back to its direct links, and what Invoice opened is hidden again.
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Receipt · mail' })).not.toBeInTheDocument());
        expect(screen.getByRole('combobox', { name: /graphViewer.focus/ })).toHaveValue('1');
      });

      it('shows one more level from the "+" badge, reading only 1 link, and leaves the double-click depth alone', async () => {
        const user = userEvent.setup();
        renderViewer();
        await screen.findByRole('button', { name: 'Hello · mail' });
        apiMocks.getGraphOutline.mockResolvedValueOnce({
          ...around, records: [{ id: 'm1', c: 'c-mail', l: 'Hello', n: 4 }, { id: 'p1', c: 'c-person', l: 'Ana', n: 2 }], links: [{ id: 'e1', r: 'r-sent', s: 'm1', t: 'p1' }],
        });
        await user.click(screen.getByRole('button', { name: 'graphViewer.moreLinks · Hello' }));
        await waitFor(() => expect(apiMocks.getGraphOutline).toHaveBeenLastCalledWith('model-1', 'rev-9', { focus: 'm1', limit: 5000 }));
        // The record is now open (it can be closed), and the Focus select shows 1 link without changing what a double-click reads.
        expect(await screen.findByRole('button', { name: 'graphViewer.collapseRecord · Hello' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: /graphViewer.focus/ })).toHaveValue('1');
        expect(screen.queryByRole('button', { name: 'Zoe · person' })).not.toBeInTheDocument();

        apiMocks.getGraphOutline.mockResolvedValueOnce(around);
        await open(user, 'Ana · person');
        await waitFor(() => expect(apiMocks.getGraphOutline).toHaveBeenLastCalledWith('model-1', 'rev-9', { focus: 'p1', depth: 2, limit: 5000 }));
      });

      it('closes a record from its "-" badge', async () => {
        const user = userEvent.setup();
        renderViewer();
        await screen.findByRole('button', { name: 'Hello · mail' });
        apiMocks.getGraphOutline.mockResolvedValueOnce(around);
        await open(user, 'Hello · mail');
        await screen.findByRole('button', { name: 'Invoice · mail' });
        apiMocks.getGraphOutline.mockResolvedValueOnce({ ...around, records: [{ id: 'm3', c: 'c-mail', l: 'Receipt', n: 1 }, { id: 'm2', c: 'c-mail', l: 'Invoice', n: 2 }], links: [{ id: 'e3', r: 'r-sent', s: 'm3', t: 'm2' }] });
        await user.click(screen.getByRole('button', { name: 'graphViewer.moreLinks · Invoice' }));
        await screen.findByRole('button', { name: 'Receipt · mail' });
        const reads = apiMocks.getGraphOutline.mock.calls.length;

        await user.click(screen.getByRole('button', { name: 'graphViewer.collapseRecord · Invoice' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Receipt · mail' })).not.toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'graphViewer.collapseRecord · Invoice' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'graphViewer.collapseRecord · Hello' })).toBeInTheDocument();
        expect(apiMocks.getGraphOutline).toHaveBeenCalledTimes(reads);
      });

      it('opens the details of a record from its "i" badge only, and the panel closes again', async () => {
        const user = userEvent.setup();
        renderViewer();
        await screen.findByRole('button', { name: 'Hello · mail' });
        // Selecting leaves the panel closed, but the selection is there for the other tools.
        await user.click(screen.getByRole('button', { name: 'Hello · mail' }));
        expect(screen.queryByRole('complementary', { name: 'graphViewer.recordPanel' })).not.toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: /graphViewer.focus/ })).toBeEnabled();
        expect(apiMocks.getGraphRecord).not.toHaveBeenCalled();

        await showDetails(user, 'Ana');
        const panel = await screen.findByRole('complementary', { name: 'graphViewer.recordPanel' });
        expect(within(panel).getByRole('heading', { name: 'Ana' })).toBeInTheDocument();
        await user.click(within(panel).getByRole('button', { name: 'graphViewer.closeRecord' }));
        expect(screen.queryByRole('complementary', { name: 'graphViewer.recordPanel' })).not.toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: /graphViewer.focus/ })).toBeEnabled();
      });

      it('says when the server kept only the closest records', async () => {
        const user = userEvent.setup();
        renderViewer();
        await screen.findByRole('button', { name: 'Hello · mail' });
        apiMocks.getGraphOutline.mockResolvedValueOnce({ ...around, truncated: true });
        await open(user, 'Hello · mail');
        expect(await screen.findByText('graphViewer.exploreCapped')).toBeInTheDocument();
      });
    });

    it('shows why the neighbours could not be loaded', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Hello · mail' });
      apiMocks.getGraphOutline.mockRejectedValueOnce(new Error('The semantic runtime did not answer in time'));
      await pick(user, 'ana', /Ana/);
      await user.click(screen.getByRole('button', { name: 'graphViewer.loadNeighbours' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('graphViewer.loadNeighboursFailed');
    });
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
      expect(screen.queryByRole('complementary', { name: 'graphViewer.recordPanel' })).not.toBeInTheDocument();
      await showDetails(user, 'Hello');

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

    it('opens on the record a chat citation names, and says when it is gone', async () => {
      const found = vi.fn();
      renderViewer({ initialRecordId: 'm2', onInitialRecord: found });
      const panel = await screen.findByRole('complementary', { name: 'graphViewer.recordPanel' });
      expect(within(panel).getByRole('heading', { name: 'Invoice' })).toBeInTheDocument();
      expect(found).toHaveBeenCalledWith(true);

      const missing = vi.fn();
      renderViewer({ initialRecordId: 'gone', onInitialRecord: missing });
      await waitFor(() => expect(missing).toHaveBeenCalledWith(false));
    });

    it('focuses on a record near it without asking the server when the whole graph is read', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Hello · mail' });
      await user.dblClick(screen.getByRole('button', { name: 'Hello · mail' }));
      expect(await screen.findByText('graphViewer.focusOn')).toBeInTheDocument();
      expect(apiMocks.getGraphOutline).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Invoice · mail' })).not.toHaveAttribute('data-more');
    });

    it('lists linked records by relationship and moves to one', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Ana · person' });
      await pick(user, 'ana', /Ana/);
      await showDetails(user, 'Ana');
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
      await showDetails(user, 'Hello');
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
      await chooseExport(user, 'graphViewer.exportWhole');
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

    it('exports the records in view as a standalone file, with their values when asked', async () => {
      const user = userEvent.setup();
      viewExportMocks.createViewExport.mockResolvedValue('<html></html>');
      apiMocks.get.mockResolvedValue({ id: 'model-1', name: 'Mails' });
      apiMocks.exportGraph.mockResolvedValue({
        modelName: 'Mails', exportedBy: 'Ana', exportedAt: '2026-10-06T10:00:00Z', shortenTo: 200, links: [],
        records: [{ id: 'm1', c: 'c-mail', l: 'Hello', v: { sujet: 'Hello' } }, { id: 'zz', c: 'c-mail', l: 'Elsewhere', v: {} }],
      });
      const createObjectURL = vi.fn(() => 'blob:view');
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
      renderViewer({ canExport: true });
      await screen.findByRole('button', { name: 'Hello · mail' });
      // Hide the correspondents: the file takes what is shown, not the whole graph.
      await user.click(within(screen.getByRole('group', { name: 'graphViewer.legend' })).getByRole('button', { name: /Correspondent/ }));
      await chooseExport(user, 'graphViewer.exportView');
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('radio', { name: /graphViewer.viewExportSvg/ })).toBeChecked();
      await user.click(within(dialog).getByRole('checkbox', { name: /graphViewer.viewExportValues/ }));
      await user.click(within(dialog).getByRole('button', { name: /graphViewer.exportRun/ }));

      await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
      const request = viewExportMocks.createViewExport.mock.calls[0][0];
      expect(request.mode).toBe('svg');
      expect([...request.ids].sort()).toEqual(['m1', 'm2']);
      // Values come from the server's whole-graph read, kept for the records in view only.
      expect([...request.values.keys()]).toEqual(['m1']);
      expect(request.canvasPositions.get('m1')).toEqual({ x: 1, y: 2 });
      expect(request.meta.title).toBe('graphViewer.exportTitle');
    });

    it('does not offer the export to people who may not take the graph out of the app', async () => {
      renderViewer();
      await screen.findByRole('button', { name: 'Hello · mail' });
      expect(screen.queryByRole('button', { name: /graphViewer.export$/ })).not.toBeInTheDocument();
    });
  });
});
