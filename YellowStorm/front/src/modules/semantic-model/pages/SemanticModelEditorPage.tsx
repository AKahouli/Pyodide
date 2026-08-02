import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  History,
  LayoutDashboard,
  Loader2,
  Network,
  Plus,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showError, showSuccess } from "@/lib/notifications";
import { useModuleTranslation } from "@/modules/localization";
import { semanticModelApi } from "../api";
import {
  AddConceptDialog,
  AddRecordDialog,
  AddRelationDialog,
} from "../components/editor/EditorDialogs";
import { SemanticModelCanvas } from "../components/editor/SemanticModelCanvas";
import { SemanticModelInspector } from "../components/editor/SemanticModelInspector";
import { VersionsPanel } from "../components/versions/VersionsPanel";
import { useKnowledgeLinking } from "../hooks/use-knowledge-linking";
import { useSemanticGraph, useSemanticModel } from "../query/hooks";
import { isPendingSaveCurrent, isSemanticGraphSaved, selectPendingOperations, useSemanticModelEditorStore } from "../store";
import type { EditorMode } from "../types";
import { layoutStructure } from "../utils/model-utils";

function apiCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

export function SemanticModelEditorPage() {
  const { modelId } = useParams();
  const { t } = useModuleTranslation("semantic-model");
  const navigate = useNavigate();
  const model = useSemanticModel(modelId);
  const graphQuery = useSemanticGraph(modelId);
  const knowledge = useKnowledgeLinking(modelId);
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const mode = useSemanticModelEditorStore((state) => state.mode);
  const pending = useSemanticModelEditorStore((state) => state.pending);
  const saveStatus = useSemanticModelEditorStore((state) => state.saveStatus);
  const saveAttempt = useSemanticModelEditorStore((state) => state.saveAttempt);
  const validation = useSemanticModelEditorStore((state) => state.validation);
  const undoStack = useSemanticModelEditorStore((state) => state.undoStack);
  const redoStack = useSemanticModelEditorStore((state) => state.redoStack);
  const hydrate = useSemanticModelEditorStore((state) => state.hydrate);
  const setMode = useSemanticModelEditorStore((state) => state.setMode);
  const commit = useSemanticModelEditorStore((state) => state.commit);
  const markSaving = useSemanticModelEditorStore((state) => state.markSaving);
  const markSaved = useSemanticModelEditorStore((state) => state.markSaved);
  const markFailed = useSemanticModelEditorStore((state) => state.markFailed);
  const retrySave = useSemanticModelEditorStore((state) => state.retrySave);
  const setValidation = useSemanticModelEditorStore(
    (state) => state.setValidation,
  );
  const undo = useSemanticModelEditorStore((state) => state.undo);
  const redo = useSemanticModelEditorStore((state) => state.redo);
  const reset = useSemanticModelEditorStore((state) => state.reset);
  const [conceptOpen, setConceptOpen] = useState(false);
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationConnection, setRelationConnection] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeTargetId, setKnowledgeTargetId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const savingRef = useRef(false);
  const hydratedVersionRef = useRef<string | null>(null);
  const knowledgeClosedAtRef = useRef(0);
  const blocker = useBlocker(pending.length > 0);
  const canEdit =
    model.data?.status !== "archived" &&
    model.data?.role !== "viewer" &&
    Boolean(model.data?.currentDraftVersionId);
  const canValidate = isSemanticGraphSaved({ graph, pending, saveStatus });

  useEffect(() => {
    if (
      !graphQuery.data ||
      hydratedVersionRef.current === graphQuery.data.versionId
    )
      return;
    hydratedVersionRef.current = graphQuery.data.versionId;
    hydrate(graphQuery.data);
  }, [graphQuery.data, hydrate]);
  useEffect(() => () => {
    hydratedVersionRef.current = null;
    reset();
  }, [reset]);
  useEffect(() => {
    setLeaveOpen(blocker.state === "blocked");
  }, [blocker.state]);

  useEffect(() => {
    if (!modelId || !graph || !pending.length || savingRef.current) return;
    const timer = window.setTimeout(async () => {
      if (!navigator.onLine) {
        markFailed("offline");
        return;
      }
      const state = useSemanticModelEditorStore.getState();
      const batch = selectPendingOperations(state.pending);
      const revision = state.graph?.revision;
      const versionId = state.graph?.versionId;
      const savedGroups = state.pending.slice(0,batch.groupCount);
      if (!batch.operations.length || revision === undefined || !versionId) return;
      const saveIsCurrent = () => isPendingSaveCurrent(useSemanticModelEditorStore.getState(),versionId,savedGroups);
      savingRef.current = true;
      markSaving();
      try {
        const result = await semanticModelApi.applyOperations(
          modelId,
          revision,
          batch.operations,
        );
        if (saveIsCurrent()) markSaved(result.revision, batch.groupCount);
      } catch (error) {
        if (saveIsCurrent()) markFailed(apiCode(error) === "ERR_3703" ? "conflict" : "error");
      } finally {
        savingRef.current = false;
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [graph, markFailed, markSaved, markSaving, modelId, pending, saveAttempt]);

  const validate = useCallback(async () => {
    const state = useSemanticModelEditorStore.getState();
    if (!modelId || !isSemanticGraphSaved(state)) return;
    const revision = state.graph!.revision;
    try {
      const result = await semanticModelApi.validate(modelId);
      if (
        !isSemanticGraphSaved(useSemanticModelEditorStore.getState(), revision)
      )
        return;
      setValidation(result.issues);
      setValidationOpen(true);
      if (!result.issues.length) showSuccess(t("validation.clean"));
    } catch (error) {
      showError(t("validation.error"), {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, [modelId, setValidation, t]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (useSemanticModelEditorStore.getState().saveInFlight) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void validate();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [redo, undo, validate]);

  const autoLayout = () => {
    if (!graph || mode === "records") return;
    const positions = layoutStructure(graph.nodes, graph.relations);
    const updates = [...positions].map(([id, position]) => ({ id, position }));
    commit({ type: "layout.update", positions: updates }, (current) => ({
      ...current,
      nodes: current.nodes.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position,
      })),
    }));
  };
  const openKnowledge = (targetId:string|null=null) => {
    if (Date.now()-knowledgeClosedAtRef.current<700) return;
    setKnowledgeTargetId(targetId);
    setKnowledgeOpen(true);
  };
  const closeKnowledge = () => {
    knowledgeClosedAtRef.current=Date.now();
    setKnowledgeOpen(false);
    setKnowledgeTargetId(null);
  };

  if (model.isLoading || graphQuery.isLoading || !graph)
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">
            {t("editor.loading")}
          </p>
        </div>
      </div>
    );
  if (model.isError || graphQuery.isError)
    return (
      <div className="flex h-[100dvh] items-center justify-center p-6">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-xl font-semibold">
            {t("editor.loadError")}
          </h1>
          <Button className="mt-5" asChild>
            <Link to="/semantic-models">{t("editor.back")}</Link>
          </Button>
        </div>
      </div>
    );

  const statusLabel = t(`save.${saveStatus}`);
  return (
    <div className="flex h-[100dvh] w-full min-w-0 max-w-full flex-col overflow-hidden bg-muted/15">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
        <Button
          size="icon"
          variant="ghost"
          asChild
          aria-label={t("editor.back")}
        >
          <Link to="/semantic-models">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="mr-2 min-w-0">
          <h1 className="max-w-48 truncate text-sm font-semibold sm:max-w-80">
            {model.data?.name}
          </h1>
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            {t(
              model.data?.kind === "workspace_default"
                ? "editor.automaticModel"
                : "editor.designedModel",
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px]">
          <Save
            className={`h-3.5 w-3.5 ${saveStatus === "saving" ? "animate-pulse text-primary" : saveStatus === "conflict" || saveStatus === "error" ? "text-destructive" : "text-muted-foreground"}`}
          />
          {statusLabel}
          {(saveStatus === "error" || saveStatus === "offline") && (
            <button type="button" className="ml-1 font-semibold text-primary underline-offset-2 hover:underline" onClick={retrySave}>
              {t("action.retry")}
            </button>
          )}
        </div>
        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as EditorMode)}
          className="order-last w-full overflow-x-auto lg:order-none lg:ml-auto lg:w-auto"
        >
          <TabsList className="w-max">
            {(["structure", "records"] as const).map(
              (item) => (
                <TabsTrigger key={item} value={item}>
                  {t(`mode.${item}`)}
                </TabsTrigger>
              ),
            )}
          </TabsList>
        </Tabs>
        <div className="order-last flex w-full items-center gap-1 overflow-x-auto [&>*]:shrink-0 lg:order-none lg:ml-2 lg:w-auto">
          {canEdit && <><Button
            size="icon"
            variant="ghost"
            disabled={!undoStack.length}
            onClick={undo}
            aria-label={t("action.undo")}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={!redoStack.length}
            onClick={redo}
            aria-label={t("action.redo")}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={mode === "records"}
            onClick={autoLayout}
            aria-label={t("action.autoLayout")}
          >
            <LayoutDashboard className="h-4 w-4" />
          </Button></>}
          <Button
            variant="outline"
            size="sm"
            className="h-11"
            onPointerUp={(event) => { if (event.pointerType === "touch") openKnowledge(); }}
            onClick={() => openKnowledge()}
          >
            <BookOpen className="mr-1.5 h-4 w-4" />
            {t("knowledge.title")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canValidate}
            onClick={() => void validate()}
          >
            <Check className="mr-1.5 h-4 w-4" />
            {t("action.validate")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVersionsOpen((open) => !open)}
          >
            <History className="mr-1.5 h-4 w-4" />
            {t("action.versions")}
          </Button>
          {canEdit && (
            <div className="order-first shrink-0 lg:order-none">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t("action.add")}
                  <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setConceptOpen(true)}>
                  {t("concept.add")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setRelationConnection(null);
                    setRelationOpen(true);
                  }}
                  disabled={graph.nodes.length < 2}
                >
                  {t("relation.add")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRecordOpen(true)}>
                  {t("records.add")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openKnowledge()}>
                  <BookOpen className="h-4 w-4" />
                  {t("knowledge.addSource")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          )}
        </div>
      </header>
      <main className="relative flex min-h-0 flex-1">
        {versionsOpen && (
          <VersionsPanel
            modelId={modelId!}
            canEdit={canEdit}
            canPublish={canEdit && saveStatus === "saved"}
            onPublished={() => {
              hydratedVersionRef.current = null;
              void graphQuery.refetch();
              void model.refetch();
            }}
          />
        )}
        <section className="relative min-w-0 flex-1">
          <SemanticModelCanvas
            canEdit={canEdit}
            knowledge={knowledge}
            onOpenKnowledge={(nodeId) => openKnowledge(nodeId)}
            onConnectRequest={(connection) => {
              setRelationConnection(connection);
              setRelationOpen(true);
            }}
          />
          {!graph.nodes.length && mode !== "records" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto max-w-sm rounded-3xl border bg-background/95 p-7 text-center shadow-xl">
                <Network className="mx-auto h-8 w-8 text-primary" />
                <h2 className="mt-3 font-semibold">{t("editor.emptyTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("editor.emptyDescription")}
                </p>
                {canEdit && (
                  <Button className="mt-5" onClick={() => setConceptOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t("concept.add")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
        <SemanticModelInspector canEdit={canEdit} knowledge={knowledge} knowledgeOpen={knowledgeOpen} knowledgeTargetId={knowledgeTargetId} onKnowledgeClose={closeKnowledge} />
        {validationOpen && (
          <aside className="absolute bottom-4 right-4 z-30 max-h-[60%] w-[min(24rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border bg-background p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">{t("validation.title")}</h2>
                <p className="text-xs text-muted-foreground">
                  {t("validation.count", { count: validation.length })}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setValidationOpen(false)}
              >
                {t("action.close")}
              </Button>
            </div>
            <div className="space-y-2">
              {validation.length ? (
                validation.map((issue, index) => (
                  <button
                    key={`${issue.code}-${issue.targetId}-${index}`}
                    className="flex w-full gap-3 rounded-xl border p-3 text-left text-xs hover:bg-muted"
                    onClick={() =>
                      issue.targetId &&
                      useSemanticModelEditorStore
                        .getState()
                        .select(issue.targetId)
                    }
                  >
                    <AlertTriangle
                      className={`h-4 w-4 shrink-0 ${issue.severity === "error" ? "text-destructive" : "text-amber-500"}`}
                    />
                    <span>{t(`validation.issue.${issue.code}`)}</span>
                  </button>
                ))
              ) : (
                <div className="rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-700">
                  {t("validation.clean")}
                </div>
              )}
            </div>
          </aside>
        )}
      </main>
      <AddConceptDialog open={conceptOpen} onOpenChange={setConceptOpen} />
      <AddRelationDialog
        open={relationOpen}
        onOpenChange={setRelationOpen}
        initialConnection={relationConnection}
      />
      <AddRecordDialog open={recordOpen} onOpenChange={setRecordOpen} />
      <Dialog open={saveStatus === "conflict"}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("conflict.title")}</DialogTitle>
            <DialogDescription>{t("conflict.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                void graphQuery.refetch().then((result) => {
                  if (result.data) {
                    hydratedVersionRef.current = null;
                    hydrate(result.data);
                  }
                })
              }
            >
              {t("conflict.reload")}
            </Button>
            <Button
              onClick={() =>
                void semanticModelApi
                  .clone(
                    modelId!,
                    `${model.data?.name} ${t("conflict.copySuffix")}`,
                  )
                  .then((copy) => navigate(`/semantic-models/${copy.id}`))
              }
            >
              {t("conflict.keepCopy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={leaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("leave.title")}</DialogTitle>
            <DialogDescription>{t("leave.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setLeaveOpen(false);
                if (blocker.state === "blocked") blocker.reset();
              }}
            >
              {t("leave.stay")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setLeaveOpen(false);
                if (blocker.state === "blocked") blocker.proceed();
              }}
            >
              {t("leave.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
