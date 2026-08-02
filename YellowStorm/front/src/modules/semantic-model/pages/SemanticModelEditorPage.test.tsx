import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticGraph } from "../types";
import { useSemanticModelEditorStore } from "../store";
import { SemanticModelEditorPage } from "./SemanticModelEditorPage";

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
    useSemanticModelEditorStore.getState().reset();
  });

  it("rehydrates cached graph data during Strict Mode effect replay", async () => {
    render(
      <StrictMode>
        <SemanticModelEditorPage />
      </StrictMode>,
    );

    expect(await screen.findByText("semantic-model-canvas")).toBeInTheDocument();
    expect(screen.queryByText("editor.loading")).not.toBeInTheDocument();
  });
});
