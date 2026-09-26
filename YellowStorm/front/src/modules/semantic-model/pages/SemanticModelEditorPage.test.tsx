import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticGraph } from "../types";
import { useSemanticModelEditorStore } from "../store";
import { SemanticModelEditorPage } from "./SemanticModelEditorPage";

const apiMocks = vi.hoisted(() => ({
  applyOperations: vi.fn(),
  rebuildAgeGraph: vi.fn(),
  connectWorkspace: vi.fn(),
  getPopulationJob: vi.fn(),
}));

vi.mock("../api", () => ({
  semanticModelApi: {
    applyOperations: apiMocks.applyOperations,
    rebuildAgeGraph: apiMocks.rebuildAgeGraph,
    connectWorkspace: apiMocks.connectWorkspace,
    getPopulationJob: apiMocks.getPopulationJob,
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

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useBlocker: () => ({ state: "unblocked" }),
    useNavigate: () => vi.fn(),
    useParams: () => ({ modelId: "model-1" }),
  };
});

vi.mock("../query/hooks", () => ({
  useMappingHealth: () => ({ data: undefined, isLoading: false }),
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
  useSourceMappings: () => ({ data: [], isLoading: false, isError: false }),
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

vi.mock("../hooks/use-semantic-build-job", () => ({
  isBuildActive: () => false,
  useSemanticBuildJob: () => ({ data: null, start: vi.fn() }),
  useStartSemanticBuild: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../components/editor/EditorDialogs", () => ({
  AddConceptDialog: () => null,
  AddRecordDialog: () => null,
  AddRelationDialog: () => null,
}));
vi.mock("../components/editor/SemanticModelCanvas", () => ({
  SemanticModelCanvas: ({ onMapStructuredDrop }: { onMapStructuredDrop?: (resource: Record<string, unknown>, nodeId: string) => void }) => <div>
    semantic-model-canvas
    <button onClick={() => onMapStructuredDrop?.({ kind: 'document', workspaceId: 'workspace-1', documentId: 'document-1', name: 'customers.xlsx', structured: true, mappable: true }, 'customer')}>map-source</button>
  </div>,
}));
vi.mock("../components/editor/SemanticModelInspector", () => ({
  SemanticModelInspector: () => null,
}));
vi.mock('../components/editor/SemanticModelValidateDialog', () => ({
  SemanticModelValidateDialog: ({ onPopulationStarted }: { onPopulationStarted: (outcome: { jobId: string; status: string; skipped: []; reused: boolean }) => void }) =>
    <button onClick={() => onPopulationStarted({ jobId: 'dialog-job', status: 'queued', skipped: [], reused: false })}>start-dialog-population</button>,
}));
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
    apiMocks.rebuildAgeGraph.mockResolvedValue({
      vertexCount: 0,
      edgeCount: 0,
      failedVertexCount: 0,
      failedEdgeCount: 0,
      graphViewerWarning: null,
    });
    apiMocks.connectWorkspace.mockResolvedValue(undefined);
    apiMocks.getPopulationJob.mockResolvedValue({ jobId: 'job-1', state: 'completed' });
    useSemanticModelEditorStore.getState().reset();
  });

  it("does not block autosave on a synchronous AGE rebuild", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'workspaceUi.diagram' }));
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
    expect(apiMocks.rebuildAgeGraph).not.toHaveBeenCalled();
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

    fireEvent.click(await screen.findByRole('button', { name: 'workspaceUi.diagram' }));
    expect(await screen.findByText("semantic-model-canvas")).toBeInTheDocument();
    expect(screen.queryByText("editor.loading")).not.toBeInTheDocument();
  });

  it("shows an empty model as not configured instead of ready", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);

    const review = await screen.findByRole('button', { name: /workspaceUi\.review/ });
    expect(review).toHaveTextContent('—');
    expect(screen.queryByText(/% ready/i)).not.toBeInTheDocument();
  });

  it('opens model health from the review action', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);

    fireEvent.click(await screen.findByRole('button', { name: /workspaceUi\.review/ }));

    expect(await screen.findByText('trust.title')).toBeInTheDocument();
  });

  it('establishes an origin workspace before opening source mapping', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><SemanticModelEditorPage /></QueryClientProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'workspaceUi.diagram' }));
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
});
