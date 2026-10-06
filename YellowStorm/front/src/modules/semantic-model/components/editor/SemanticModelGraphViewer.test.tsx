import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticModelGraphViewer } from './SemanticModelGraphViewer';

const apiMocks = vi.hoisted(() => ({
  getAgeGraph: vi.fn(),
  graph: vi.fn(),
  listCorrections: vi.fn(),
}));

vi.mock('../../api', () => ({ semanticModelApi: apiMocks }));

const node = (id: string, concept: string, label: string, values: Record<string, unknown>) => ({
  id, label: concept, properties: { record_label: label, concept_id: `c-${concept}`, ...values, _meta: { nodeTypeLabel: concept, attributes: Object.entries(values).map(([key, value]) => ({ key, label: key, value })) } },
});

const LONG = 'Bonjour, '.repeat(40);
const graph = {
  nodes: [
    node('m1', 'mail', 'Hello', { sujet: 'Hello', corps: LONG, cle_message: null }),
    node('m2', 'mail', 'Invoice', { sujet: 'Invoice', corps: 'Short', cle_message: 'k2' }),
    node('p1', 'person', 'Ana', { nom: 'Ana' }),
  ],
  edges: [
    { id: 'e1', label: 'r-sent', sourceId: 'm1', targetId: 'p1', properties: {} },
    { id: 'e2', label: 'r-sent', sourceId: 'm2', targetId: 'p1', properties: {} },
  ],
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
    apiMocks.getAgeGraph.mockResolvedValue({ nodes: [], edges: [] });
    apiMocks.graph.mockResolvedValue({ nodes: [], relations: [], records: [], recordRelations: [] });
    apiMocks.listCorrections.mockResolvedValue({ corrections: [] });
  });

  it('refreshes the runtime graph without exposing graph mutations', async () => {
    const user = userEvent.setup();
    renderViewer();
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'graphViewer.refresh' }));

    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'graphViewer.addNode' })).not.toBeInTheDocument();
  });

  it('reads the requested data revision', async () => {
    renderViewer({ dataRevisionId: 'rev-1' });
    await waitFor(() => expect(apiMocks.getAgeGraph).toHaveBeenCalledWith('model-1', 'rev-1'));
  });

  describe('with records', () => {
    beforeEach(() => {
      apiMocks.getAgeGraph.mockResolvedValue(graph);
      apiMocks.graph.mockResolvedValue(structure);
    });

    it('finds a record and shows its values by their names, long ones folded and missing ones apart', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Hello · Message' });
      await pick(user, 'hel', /Hello/);

      const panel = screen.getByRole('complementary', { name: 'graphViewer.recordPanel' });
      expect(within(panel).getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
      expect(within(panel).getByText('Subject')).toBeInTheDocument();
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
      await screen.findByRole('button', { name: 'Ana · Correspondent' });
      await pick(user, 'ana', /Ana/);
      const linked = screen.getByRole('region', { name: 'graphViewer.linked' });
      expect(within(linked).getByRole('button', { name: /sent by.*2 Message/ })).toBeInTheDocument();
      await user.click(within(linked).getByRole('button', { name: 'Invoice' }));
      expect(screen.getByRole('heading', { name: 'Invoice' })).toBeInTheDocument();
    });

    it('fixes a value from its own line when editing is allowed', async () => {
      const user = userEvent.setup();
      renderViewer({ canEdit: true });
      await screen.findByRole('button', { name: 'Hello · Message' });
      await pick(user, 'hel', /Hello/);
      const panel = screen.getByRole('complementary', { name: 'graphViewer.recordPanel' });
      expect(within(panel).getAllByRole('button', { name: 'corrections.fixValueOf' }).length).toBe(2);
      expect(within(panel).getByRole('button', { name: 'corrections.hideRecord' })).toBeInTheDocument();
    });

    it('hides and shows a concept from the legend', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Ana · Correspondent' });
      const legend = screen.getByRole('group', { name: 'graphViewer.legend' });
      await user.click(within(legend).getByRole('button', { name: /Correspondent/ }));
      expect(screen.queryByRole('button', { name: 'Ana · Correspondent' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hello · Message' })).toBeInTheDocument();
      await user.click(within(legend).getByRole('button', { name: 'graphViewer.showAll' }));
      expect(await screen.findByRole('button', { name: 'Ana · Correspondent' })).toBeInTheDocument();
    });

    it('shows figures in the overview and how two records are connected', async () => {
      const user = userEvent.setup();
      renderViewer();
      await screen.findByRole('button', { name: 'Ana · Correspondent' });
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
  });
});
