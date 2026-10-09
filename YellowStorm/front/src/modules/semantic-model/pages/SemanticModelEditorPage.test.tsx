import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticGraph } from "../types";
import { useSemanticModelEditorStore } from "../store";
import { SemanticModelEditorPage } from "./SemanticModelEditorPage";

const apiMocks = vi.hoisted(() => ({
  applyOperations: vi.fn(),
  connectWorkspace: vi.fn(),
  getPopulationJob: vi.fn(),
  stopPopulationJob: vi.fn(),
  stopSearchIndex: vi.fn(),
  restartSearchIndex: vi.fn(),
}));
// The state of the search index the page follows; undefined: nothing is being built.
const indexMock = vi.hoisted(() => ({ state: undefined as string | undefined, stalled: false }));
// The model check the page follows; undefined: it is still loading or could not be read.
const checkMock = vi.hoisted(() => ({ result: undefined as Record<string, unknown> | undefined }));
const checkOf = (issues: Array<{ severity: 'error' | 'warning'; code: string; message: string; conceptId?: string }>) => ({
  modelId: 'model-1', versionKey: 'v1', checkedAt: '', issues,
  errorCount: issues.filter((issue) => issue.severity === 'error').length,
  warningCount: issues.filter((issue) => issue.severity === 'warning').length,
});

vi.mock("../api", () => ({
  semanticModelApi: {
    applyOperations: apiMocks.applyOperations,
    connectWorkspace: apiMocks.connectWorkspace,
    getPopulationJob: apiMocks.getPopulationJob,
    stopPopulationJob: apiMocks.stopPopulationJob,
    stopSearchIndex: apiMocks.stopSearchIndex,
    restartSearchIndex: apiMocks.restartSearchIndex,
  },
}));

const graph: SemanticGraph = {
  modelId: "model-1",
  versionId: "version-1",
  revision: 0,
  nodes: [],
  relations: [],
  records: [],
  recordRelations: [],
};

const searchParams = new URLSearchParams();
const setSearchParams = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useBlocker: () => ({ state: "unblocked" }),
    useNavigate: () => vi.fn(),
    useParams: () => ({ modelId: "model-1" }),
    useSearchParams: () => [searchParams, setSearchParams],
  };
});

vi.mock("../query/hooks", () => ({
  useDerivedSources: () => ({ data: [], isLoading: false }),
  useSemanticDataPreview: () => ({ data: undefined, isLoading: false }),
  useMappingHealth: () => ({ data: undefined, isLoading: false }),
  useModelCheck: () => ({ data: checkMock.result, isLoading: false, isError: false }),
  useSemanticModel: () => ({
    data: {
      id: "model-1",
      name: "Model",
      status: "draft",
      role: "owner",
      kind: "custom",
      currentDraftVersionId: "version-1",
    },
    isLoading: false,
    isError: false,
  }),
  useSemanticGraph: () => ({ data: graph, isLoading: false, isError: false }),
  useSemanticReadiness: () => ({ data: { status: 'not_configured', score: 0, completeAreas: 0, totalAreas: 5, areas: [] }, isLoading: false, isError: false }),
  useModelHealth: () => ({ data: { state: 'no_data', dataRevisionId: null, verdict: null, concepts: [], setup: [],
    summary: { concepts: 0, healthy: 0, rowsRead: 0, recordsKept: 0, fixesNeeded: 0, limits: 0, setupItems: 0 } }, isLoading: false, isError: false }),
  useSourceMappings: () => ({ data: [], isLoading: false, isError: false }),
  useIdentityRules: () => ({ data: [], isLoading: false }),
  useLabelFields: () => ({ data: [], isLoading: false }),
  useCanvasPositions: () => ({ data: [], isLoading: false }),
  useSemanticVersions: () => ({ data: [], isLoading: false }),
  useVersionComparison: () => ({ data: undefined, isLoading: false }),
  usePopulationFreshness: () => ({ data: undefined, isLoading: false }),
  useGraphStatus: () => ({ data: undefined, isLoading: false, isError: false }),
  isIndexBuilding: (state?: string) => state === 'queued' || state === 'indexing',
  useSearchIndexStatus: () => ({ data: indexMock.state ? { index: { state: indexMock.state, stalled: indexMock.stalled } } : undefined }),
  useSemanticReviewItems: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("../hooks/use-knowledge-linking", () => ({
  useKnowledgeLinking: () => ({
    bindings: [],
    workspaceLinks: [],
    countsByNode: {},
    draggedResource: null,
    isBusy: false,
    setDraggedResource: vi.fn(),
    hasBinding: vi.fn(),
    link: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock("../components/editor/EditorDialogs", () => ({
  AddConceptDialog: () => null,
  AddRecordDialog: () => null,
  AddRelationDialog: () => null,
}));
vi.mock("../components/editor/SemanticModelCanvas", () => ({
  SemanticModelCanvas: ({ onMapStructuredDrop, onPaneDrop, onOpenSource }: { onMapStructuredDrop?: (resource: Record<string, unknown>, nodeId: string) => void; onPaneDrop?: (resource: Record<string, unknown>) => void; onOpenSource?: (source: Record<string, unknown>) => void }) => <div>
    semantic-model-canvas
    <button onClick={() => onMapStructuredDrop?.({ kind: 'document', workspaceId: 'workspace-1', documentId: 'document-1', name: 'customers.xlsx', structured: true, mappable: true }, 'customer')}>map-source</button>
    <button onClick={() => onPaneDrop?.({ kind: 'document', workspaceId: 'workspace-1', documentId: 'document-2', name: 'suppliers.xlsx', structured: true, mappable: true })}>drop-on-pane</button>
    <button onClick={() => onOpenSource?.({ id: 'typed:customer', kind: 'typed', mappings: [] })}>open-typed</button>
  </div>,
}));
vi.mock("../components/editor/SemanticModelInspector", () => ({
  SemanticModelInspector: () => null,
}));
vi.mock('../components/editor/SemanticModelValidateDialog', () => ({
  SemanticModelValidateDialog: ({ onPopulationStarted }: { onPopulationStarted: (outcome: { jobId: string; status: string; skipped: []; reused: boolean }) => void }) =>
    <button onClick={() => onPopulationStarted({ jobId: 'dialog-job', status: 'queued', skipped: [], reused: false })}>start-dialog-population</button>,
}));
vi.mock('../components/population/SearchIndexProgress', () => ({ SearchIndexProgress: () => <div>index-progress</div> }));
vi.mock("../components/versions/VersionsPanel", () => ({
  VersionsPanel: () => null,
}));
vi.mock("../components/mapping/SourceMappingDrawer", () => ({
  sourceMappingTargetFromResource: (resource: Record<string, unknown>, conceptId: string) => ({
    workspaceId: resource.workspaceId, documentId: resource.documentId, documentName: resource.name,
    assetKind: 'excel_sheet', conceptId,
  }),
  SourceMappingDrawer: ({ target }: { target: { documentName: string } | null }) => target ? <div>{target.documentName}</div> : null,
}));
vi.mock('../components/mapping/SemanticMappingsView', () => ({
  SemanticMappingsView: ({ onPopulationAccepted }: { onPopulationAccepted?: (jobId: string) => void }) =>
    <button onClick={() => onPopulationAccepted?.('job-1')}>accept-population</button>,
}));
vi.mock('../components/preview/SemanticDataPreview', () => ({
  SemanticDataPreview: ({ dataRevisionId, onDataRevision }: { dataRevisionId?: string; onDataRevision: (revisionId: string) => void }) => <>
    <span>{`revision:${dataRevisionId ?? 'none'}`}</span>
    <button onClick={() => onDataRevision('old-revision')}>pin-revision</button>
  </>,
}));

describe("SemanticModelEditorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.applyOperations.mockResolvedValue({ revision: 1 });
    apiMocks.connectWorkspace.mockResolvedValue(undefined);
    apiMocks.getPopulationJob.mockResolvedValue({ jobId: 'job-1', state: 'completed' });
    apiMocks.stopPopulationJob.mockResolvedValue({ jobId: 'dialog-job', state: 'cancel_requested' });
    apiMocks.stopSearchIndex.mockResolvedValue({ stopped: true, index: { state: 'indexing' } });
    indexMock.state = undefined;
    indexMock.stalled = false;
    checkMock.result = undefined;
    apiMocks.restartSearchIndex.mockResolvedValue({ restarted: true, index: { state: 'queued' } });
    useSemanticModelEditorStore.getState().reset();
  });

  it("autosaves graph operations", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);
    await screen.findByText("semantic-model-canvas");

    act(() => {
      useSemanticModelEditorStore.getState().commit(
        {
          type: "node_type.create",
          entity: {
            id: "node-1",
            key: "customer",
            label: "Customer",
            description: "",
            category: "business_object",
            recordPolicy: "optional",
            systemKey: null,
            aliases: [],
            attributes: [],
            position: { x: 0, y: 0 },
          },
        },
        (current) => current,
      );
    });

    await waitFor(() => expect(apiMocks.applyOperations).toHaveBeenCalled(), { timeout: 2_000 });
  });

  it("rehydrates cached graph data during Strict Mode effect replay", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <StrictMode>
          <SemanticModelEditorPage />
        </StrictMode>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("semantic-model-canvas")).toBeInTheDocument();
    expect(screen.queryByText("editor.loading")).not.toBeInTheDocument();
  });

  it("opens on the canvas with a draft status and no percentage", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);

    expect(await screen.findByText("semantic-model-canvas")).toBeInTheDocument();
    expect(screen.getByText('designer.status.draft')).toBeInTheDocument();
    expect(screen.getByText('designer.empty.title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'designer.empty.start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /health.button/ })).not.toHaveTextContent('%');
    expect(screen.queryByRole('navigation', { name: 'journey.title' })).not.toBeInTheDocument();
  });

  it('maps a file dropped on empty canvas without a concept chosen', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'drop-on-pane' }));

    expect(await screen.findByText('suppliers.xlsx')).toBeInTheDocument();
  });

  it('opens the records for a typed-records source', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'open-typed' }));

    expect(await screen.findByText('revision:none')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /designer.backToCanvas/ }));
    expect(await screen.findByText('semantic-model-canvas')).toBeInTheDocument();
  });

  it('opens model health in place of the canvas and goes back to it', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);

    fireEvent.click(await screen.findByRole('button', { name: /health.button/ }));

    expect(await screen.findByText('health.noData.title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /health.button/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('semantic-model-canvas')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /designer.backToCanvas/ }));
    expect(await screen.findByText('semantic-model-canvas')).toBeInTheDocument();
  });

  it('establishes an origin workspace before opening source mapping', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'map-source' }));

    await waitFor(() => expect(apiMocks.connectWorkspace).toHaveBeenCalledWith('model-1', 'workspace-1', false));
    expect(await screen.findByText('customers.xlsx')).toBeInTheDocument();
  });

  it('releases the revision pin when population completes after leaving mappings', async () => {
    let completeJob!: (value: unknown) => void;
    apiMocks.getPopulationJob.mockImplementationOnce(() => new Promise((resolve) => { completeJob = resolve; }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);

    act(() => useSemanticModelEditorStore.getState().setMode('records'));
    fireEvent.click(await screen.findByText('pin-revision'));
    expect(screen.getByText('revision:old-revision')).toBeInTheDocument();
    act(() => useSemanticModelEditorStore.getState().setMode('mappings'));
    fireEvent.click(await screen.findByText('accept-population'));
    await waitFor(() => expect(apiMocks.getPopulationJob).toHaveBeenCalledWith('model-1', 'job-1'));
    act(() => useSemanticModelEditorStore.getState().setMode('structure'));

    completeJob({ jobId: 'job-1', state: 'completed' });
    await waitFor(() => expect(queryClient.getQueryData(['semantic-models', 'population-job', 'model-1', 'job-1'])).toMatchObject({ state: 'completed' }));
    act(() => useSemanticModelEditorStore.getState().setMode('records'));
    expect(await screen.findByText('revision:none')).toBeInTheDocument();
  });

  it('tracks population launched from validation', async () => {
    apiMocks.getPopulationJob.mockResolvedValueOnce({ jobId: 'dialog-job', state: 'completed' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);

    act(() => useSemanticModelEditorStore.getState().setMode('records'));
    fireEvent.click(await screen.findByText('pin-revision'));
    act(() => useSemanticModelEditorStore.getState().setMode('structure'));
    fireEvent.click(await screen.findByText('start-dialog-population'));

    await waitFor(() => expect(apiMocks.getPopulationJob).toHaveBeenCalledWith('model-1', 'dialog-job'));
    await waitFor(() => expect(queryClient.getQueryData(['semantic-models', 'population-job', 'model-1', 'dialog-job'])).toMatchObject({ state: 'completed' }));
    act(() => useSemanticModelEditorStore.getState().setMode('records'));
    expect(await screen.findByText('revision:none')).toBeInTheDocument();
  });

  const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><SemanticModelEditorPage /></QueryClientProvider>);
  const stopButtons = () => screen.getAllByRole('button', { name: /runStop\.stop/ });

  it('turns Run into Stop while a data update runs, and asks before stopping it', async () => {
    apiMocks.getPopulationJob.mockResolvedValue({ jobId: 'dialog-job', state: 'running', progress: { phase: 'reading', total: 3, done: 1 } });
    renderPage();
    fireEvent.click(await screen.findByText('start-dialog-population'));
    await waitFor(() => expect(apiMocks.getPopulationJob).toHaveBeenCalledWith('model-1', 'dialog-job'));

    await waitFor(() => expect(screen.queryByText('designer.run')).not.toBeInTheDocument());
    const header = stopButtons()[0];
    expect(header).toBeEnabled();
    fireEvent.click(header);
    // Nothing is stopped until the person confirms.
    expect(await screen.findByText('runStop.confirmTitle')).toBeInTheDocument();
    expect(apiMocks.stopPopulationJob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('runStop.confirmAction'));
    await waitFor(() => expect(apiMocks.stopPopulationJob).toHaveBeenCalledWith('model-1', 'dialog-job'));
  });

  it('keeps Stop, disabled, once the data is being saved', async () => {
    apiMocks.getPopulationJob.mockResolvedValue({ jobId: 'dialog-job', state: 'running', progress: { phase: 'saving', total: 3, done: 3, cancellable: false } });
    renderPage();
    fireEvent.click(await screen.findByText('start-dialog-population'));
    await waitFor(() => expect(apiMocks.getPopulationJob).toHaveBeenCalledWith('model-1', 'dialog-job'));

    await waitFor(() => expect(stopButtons().length).toBeGreaterThan(1));
    for (const button of stopButtons()) expect(button).toBeDisabled();
    expect(apiMocks.stopPopulationJob).not.toHaveBeenCalled();
  });

  it('turns Run into Stop while the search index is built, and stops that build after a confirmation', async () => {
    indexMock.state = 'indexing';
    renderPage();
    await screen.findByText('semantic-model-canvas');
    expect(screen.queryByText('designer.run')).not.toBeInTheDocument();
    fireEvent.click(stopButtons()[0]);
    expect(await screen.findByText('runStop.indexConfirmTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('runStop.indexConfirmAction'));
    await waitFor(() => expect(apiMocks.stopSearchIndex).toHaveBeenCalledWith('model-1'));
    expect(apiMocks.stopPopulationJob).not.toHaveBeenCalled();
  });

  it('offers Restart next to Stop only while the search index build is stalled', async () => {
    indexMock.state = 'indexing';
    const { unmount } = renderPage();
    await screen.findByText('semantic-model-canvas');
    expect(screen.queryByRole('button', { name: 'runStop.restart' })).not.toBeInTheDocument();
    unmount();

    indexMock.stalled = true;
    renderPage();
    await screen.findByText('semantic-model-canvas');
    expect(stopButtons().length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'runStop.restart' }));
    await waitFor(() => expect(apiMocks.restartSearchIndex).toHaveBeenCalledWith('model-1'));
    expect(apiMocks.stopSearchIndex).not.toHaveBeenCalled();
  });

  it('brings the progress panel back from the header while an update runs, whatever closed it', async () => {
    apiMocks.getPopulationJob.mockResolvedValue({ jobId: 'dialog-job', state: 'running', progress: { phase: 'reading', total: 3, done: 1 } });
    renderPage();
    fireEvent.click(await screen.findByText('start-dialog-population'));
    expect(await screen.findByText('population.started')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'action.close' }));
    expect(screen.queryByText('population.started')).not.toBeInTheDocument();
    const show = screen.getByRole('button', { name: 'runStatus.showRun' });
    fireEvent.click(show);
    expect(await screen.findByText('population.started')).toBeInTheDocument();
    // Pressed again, it hides the panel.
    fireEvent.click(screen.getByRole('button', { name: 'runStatus.hide' }));
    expect(screen.queryByText('population.started')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'runStatus.showRun' })).toBeInTheDocument();
  });

  it('keeps the last result one click away after the update ended and its panel was closed', async () => {
    apiMocks.getPopulationJob.mockResolvedValue({ jobId: 'dialog-job', state: 'completed' });
    renderPage();
    expect(screen.queryByRole('button', { name: /runStatus\./ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('start-dialog-population'));
    expect(await screen.findByText('population.done')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'action.close' }));
    expect(screen.queryByText('population.done')).not.toBeInTheDocument();
    // Run is back, and the result stays reachable.
    expect(screen.getByText('designer.run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'runStatus.showLast' }));
    expect(await screen.findByText('population.done')).toBeInTheDocument();
  });

  it('shows the search index build in its own panel when no update is attached to it', async () => {
    indexMock.state = 'indexing';
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'runStatus.showIndex' }));

    expect(await screen.findByText('index-progress')).toBeInTheDocument();
    expect(screen.getByText('runStatus.indexTitle')).toBeInTheDocument();
    // Stop is in the panel too, and asks first.
    fireEvent.click(stopButtons()[stopButtons().length - 1]);
    expect(await screen.findByText('runStop.indexConfirmTitle')).toBeInTheDocument();
  });

  describe('model check', () => {
    const runButton = async () => (await screen.findByText('designer.run')).closest('button')!;

    it('keeps Run free while the check is loading or could not be read', async () => {
      renderPage();
      expect(await runButton()).toBeEnabled();
    });

    it('holds Run back while the model has errors, and says why', async () => {
      checkMock.result = checkOf([{ severity: 'warning', code: 'relation_without_rule', message: 'No rule' }, { severity: 'error', code: 'no_identity', message: 'No unique field', conceptId: 'customer' }]);
      renderPage();
      const run = await runButton();
      expect(run).toBeDisabled();
      expect(run).toHaveAttribute('title', expect.stringContaining('check.blocked'));
      expect(run).toHaveAttribute('title', expect.stringContaining('check.no_identity'));
    });

    it('never holds Run back for warnings', async () => {
      checkMock.result = checkOf([{ severity: 'warning', code: 'runtime_unavailable', message: 'Not checked' }]);
      renderPage();
      expect(await runButton()).toBeEnabled();
    });
  });

  it('shows Run when nothing is running', async () => {
    renderPage();
    expect(await screen.findByText('designer.run')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /runStop\.stop/ })).not.toBeInTheDocument();
  });
});
