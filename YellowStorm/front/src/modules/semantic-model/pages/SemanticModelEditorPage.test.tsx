import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticGraph } from "../types";
import { useSemanticModelEditorStore } from "../store";
import { SemanticModelEditorPage } from "./SemanticModelEditorPage";

const apiMocks = vi.hoisted(() => ({
  applyOperations: vi.fn(),
  rebuildAgeGraph: vi.fn(),
}));

vi.mock("../api", () => ({
  semanticModelApi: {
    applyOperations: apiMocks.applyOperations,
    rebuildAgeGraph: apiMocks.rebuildAgeGraph,
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
  SemanticModelCanvas: () => <div>semantic-model-canvas</div>,
}));
vi.mock("../components/editor/SemanticModelInspector", () => ({
  SemanticModelInspector: () => null,
}));
vi.mock("../components/versions/VersionsPanel", () => ({
  VersionsPanel: () => null,
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
    useSemanticModelEditorStore.getState().reset();
  });

  it("does not block autosave on a synchronous AGE rebuild", async () => {
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

    expect(await screen.findByText("semantic-model-canvas")).toBeInTheDocument();
    expect(screen.queryByText("editor.loading")).not.toBeInTheDocument();
  });
});
