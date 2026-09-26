import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  History,
  LayoutDashboard,
  LayoutList,
  Loader2,
  Network,
  Plus,
  Redo2,
  Save,
  Undo2,
  Zap,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showError, showSuccess } from "@/lib/notifications";
import { parseApiError } from "@/lib/api-error";
import { useModuleTranslation } from "@/modules/localization";
import { semanticModelApi } from "../api";
import {
  AddConceptDialog,
  AddRecordDialog,
  AddRelationDialog,
} from "../components/editor/EditorDialogs";
import { SemanticModelCanvas } from "../components/editor/SemanticModelCanvas";
import { ObjectNavigator } from "../components/editor/ObjectNavigator";
import { SemanticModelInspector } from "../components/editor/SemanticModelInspector";
import { SemanticModelGraphViewer } from "../components/editor/SemanticModelGraphViewer";
import { SemanticModelValidateDialog } from "../components/editor/SemanticModelValidateDialog";
import { SemanticModelBuildProgressBanner } from "../components/editor/SemanticModelBuildProgressBanner";
import { SourceMappingDrawer, sourceMappingTargetFromResource, type SourceMappingTarget } from "../components/mapping/SourceMappingDrawer";
import { SemanticMappingsView } from '../components/mapping/SemanticMappingsView';
import { SemanticDataPreview } from '../components/preview/SemanticDataPreview';
import { SemanticTrustPanel } from '../components/review/SemanticTrustPanel';
import { PopulationStartedPanel, type PopulationOutcome } from '../components/population/PopulationStartedPanel';
import { isBuildActive, useSemanticBuildJob } from "../hooks/use-semantic-build-job";
import { VersionsPanel } from "../components/versions/VersionsPanel";
import { useKnowledgeLinking } from "../hooks/use-knowledge-linking";
import { useMappingHealth, useSemanticGraph, useSemanticModel, useSemanticReadiness, useSourceMappings } from "../query/hooks";
import { semanticModelQueryKeys } from '../query/queryKeys';
import { isPendingSaveCurrent, isSemanticGraphSaved, selectPendingOperations, useSemanticModelEditorStore } from "../store";
import type { EditorMode } from "../types";
import { layoutStructure } from "../utils/model-utils";

function apiCode(error: unknown): string | undefined {
  return parseApiError(error).code;
}

const POPULATION_TERMINAL_STATES = new Set(['completed', 'completed_with_gaps', 'failed', 'cancelled', 'superseded']);

export function SemanticModelEditorPage() {
  const { modelId } = useParams();
  const { t } = useModuleTranslation("semantic-model");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const model = useSemanticModel(modelId);
  const graphQuery = useSemanticGraph(modelId);
  const readiness = useSemanticReadiness(modelId);
  const knowledge = useKnowledgeLinking(modelId);
  const sourceMappings = useSourceMappings(modelId);
  const mappingHealth = useMappingHealth(sourceMappings.data?.length ? modelId : undefined);
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const mode = useSemanticModelEditorStore((state) => state.mode);
  const pending = useSemanticModelEditorStore((state) => state.pending);
  const saveStatus = useSemanticModelEditorStore((state) => state.saveStatus);
  const saveAttempt = useSemanticModelEditorStore((state) => state.saveAttempt);
  const validation = useSemanticModelEditorStore((state) => state.validation);
  const selectedId = useSemanticModelEditorStore((state) => state.selectedId);
  const select = useSemanticModelEditorStore((state) => state.select);
  const focusRequest = useSemanticModelEditorStore((state) => state.focusRequest);
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
  const [checking, setChecking] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeTargetId, setKnowledgeTargetId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const [graphViewerOpen, setGraphViewerOpen] = useState(false);
  const [boundDataRevisionId, setBoundDataRevisionId] = useState<string>();
  const [populationJobId, setPopulationJobId] = useState<string>();
  const [trustOpen, setTrustOpen] = useState(false);
  const [structureView, setStructureView] = useState<'list' | 'diagram'>('list');
  const [population, setPopulation] = useState<PopulationOutcome | null>(null);
  useEffect(() => setBoundDataRevisionId(undefined), [modelId]);
  const populationJob = useQuery({
    queryKey: ['semantic-models', 'population-job', modelId, populationJobId],
    queryFn: () => semanticModelApi.getPopulationJob(modelId!, populationJobId!),
    enabled: Boolean(modelId && populationJobId),
    refetchInterval: (query) => POPULATION_TERMINAL_STATES.has(query.state.data?.state ?? '') ? false : 2000,
    retry: false,
  });
  useEffect(() => {
    if (!populationJob.data || !POPULATION_TERMINAL_STATES.has(populationJob.data.state)) return;
    if (['completed', 'completed_with_gaps'].includes(populationJob.data.state)) setBoundDataRevisionId(undefined);
    setPopulationJobId(undefined);
  }, [populationJob.data]);
  const [mappingTarget, setMappingTarget] = useState<SourceMappingTarget | null>(null);
  const openMappingTarget = useCallback(async (target: SourceMappingTarget) => {
    if (!modelId) return;
    const linked = knowledge.workspaceLinks.some((item) => item.workspaceId === target.workspaceId && item.enabled);
    const hasOrigin = knowledge.workspaceLinks.some((item) => item.role === 'origin' && item.enabled);
    try {
      if (!linked || !hasOrigin) {
        await semanticModelApi.connectWorkspace(modelId, target.workspaceId, false);
        void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) });
        void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.workspaces(modelId) });
      }
      setMappingTarget(target);
    } catch (error) {
      showError(t('sourceAnalysis.error'), { description: error instanceof Error ? error.message : undefined });
    }
  }, [knowledge.workspaceLinks, modelId, queryClient, t]);
  const savingRef = useRef(false);
  const hydratedVersionRef = useRef<string | null>(null);
  const autoSelectedModelRef = useRef<string | null>(null);
  const knowledgeClosedAtRef = useRef(0);
  const blocker = useBlocker(pending.length > 0);
  const canEdit =
    model.data?.status !== "archived" &&
    model.data?.role !== "viewer" &&
    Boolean(model.data?.currentDraftVersionId);
  const canValidate = canEdit && isSemanticGraphSaved({ graph, pending, saveStatus });
  const buildJob = useSemanticBuildJob(modelId, Boolean(model.data && model.data.executionOwner !== 'runtime'));
  const buildActive = isBuildActive(buildJob.data);
  useEffect(() => {
    if (
      !graphQuery.data ||
      hydratedVersionRef.current === graphQuery.data.versionId
    )
      return;
    hydratedVersionRef.current = graphQuery.data.versionId;
    hydrate(graphQuery.data);
  }, [graphQuery.data, hydrate]);
  useEffect(() => {
    if (!graph || !modelId || autoSelectedModelRef.current === modelId) return;
    autoSelectedModelRef.current = modelId;
    if (!selectedId) select(graph.nodes.find((node) => !node.systemKey)?.id ?? null);
  }, [graph, modelId, select, selectedId]);
  useEffect(() => () => {
    hydratedVersionRef.current = null;
    reset();
  }, [reset]);
  useEffect(() => {
    setLeaveOpen(blocker.state === "blocked");
  }, [blocker.state]);

  // Selecting something on the canvas means "show me this", so details take the panel back —
  // unless the selection came from a health finding, which should keep its list in view.
  useEffect(() => {
    if (selectedId && focusRequest?.id !== selectedId) setTrustOpen(false);
  }, [focusRequest, selectedId]);

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
        if (batch.operations.some((operation) => operation.type !== 'layout.update')) {
          queryClient.setQueryData(semanticModelQueryKeys.model(modelId), (current: typeof model.data) => current ? { ...current,indexStatus: 'pending' as const,indexError: null } : current);
          void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.all });
        }
        if (saveIsCurrent()) markSaved(result.revision, batch.groupCount);
      } catch (error) {
        if (saveIsCurrent()) {
          const apiError = parseApiError(error);
          markFailed(apiError.code === "ERR_3703" ? "conflict" : "error");
          showError(t("save.error"), { description: `[${apiError.code}] ${apiError.message}` });
        }
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
    setChecking(true);
    try {
      const result = await semanticModelApi.validate(modelId);
      if (
        !isSemanticGraphSaved(useSemanticModelEditorStore.getState(), revision)
      )
        return;
      setValidation(result.issues);
      setTrustOpen(true);
      if (!result.issues.length) showSuccess(t("validation.clean"));
    } catch (error) {
      showError(t("validation.error"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setChecking(false);
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
    if (!graph || mode !== "structure") return;
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
  const readinessScore = readiness.data?.status === 'not_configured' ? undefined : readiness.data?.score;
  const openGraphViewer = () => {
    setGraphViewerOpen(true);
  };
  return (
    <div className="flex h-[100dvh] w-full min-w-0 max-w-full flex-col overflow-hidden bg-muted/15">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
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
        <div className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px]" title={model.data?.indexError ?? undefined}>
          <span className={`h-2 w-2 rounded-full ${model.data?.indexStatus === 'indexed' ? 'bg-emerald-500' : model.data?.indexStatus === 'failed' ? 'bg-red-500' : `bg-amber-500 ${model.data?.indexStatus === 'pending' || model.data?.indexStatus === 'in_progress' ? 'animate-pulse' : ''}`}`} />
          {t(model.data?.indexStatus === 'indexed' ? 'indexStatus.indexed' : model.data?.indexStatus === 'failed' ? 'indexStatus.failed' : 'indexStatus.working')}
        </div>
      </header>
      <div className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-2'>
        <Tabs value={mode} onValueChange={(value) => { setMode(value as EditorMode); if (value === 'structure') select(graph.nodes.find((node) => !node.systemKey)?.id ?? null); setTrustOpen(false); }} className='min-w-0 overflow-x-auto'><TabsList className='w-max'>{(['structure', 'mappings', 'records'] as const).map((item) => <TabsTrigger key={item} value={item}>{t(`mode.${item}`)}</TabsTrigger>)}</TabsList></Tabs>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          {mode === 'mappings' && canEdit && <Button size='sm' variant='outline' onClick={() => openKnowledge()}><BookOpen className='mr-1.5 h-4 w-4' /><span className='sm:hidden'>{t('workspaceUi.addSourceShort')}</span><span className='hidden sm:inline'>{t('knowledge.addSource')}</span></Button>}
          {mode === 'records' && canEdit && <Button size='sm' variant='outline' onClick={() => setRecordOpen(true)}><Plus className='mr-1.5 h-4 w-4' /><span className='sm:hidden'>{t('workspaceUi.addRecordShort')}</span><span className='hidden sm:inline'>{t('records.add')}</span></Button>}
          <Button variant='outline' size='sm' onClick={openGraphViewer}><Network className='mr-1.5 h-4 w-4' />{t('dataWorkflow.dataGraph')}</Button>
          <Button variant='outline' size='sm' onClick={() => { setKnowledgeOpen(false); setTrustOpen(true); setVersionsOpen(false); }}>{t('workspaceUi.review')}<span className='ml-2 text-muted-foreground'>{readinessScore === undefined ? '—' : `${readinessScore}%`}</span></Button>
          <Button variant='outline' size='sm' onClick={() => { setKnowledgeOpen(false); setVersionsOpen((open) => !open); }}><History className='mr-1.5 h-4 w-4' /><span className='sm:hidden'>{t('workspaceUi.publishShort')}</span><span className='hidden sm:inline'>{t('workspaceUi.publish')}</span></Button>
        </div>
      </div>
      {modelId && model.data?.executionOwner !== 'runtime' && (
        <SemanticModelBuildProgressBanner
          modelId={modelId}
          onRetry={() => setValidateOpen(true)}
        />
      )}
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
        <section className="relative flex min-w-0 flex-1 flex-col">
          {mode === 'structure' && <div className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-2'><div className='flex items-center gap-2'><Button size='sm' variant={structureView === 'list' ? 'secondary' : 'ghost'} onClick={() => setStructureView('list')} aria-pressed={structureView === 'list'}><LayoutList className='mr-2 h-4 w-4' />{t('workspaceUi.list')}</Button><Button size='sm' variant={structureView === 'diagram' ? 'secondary' : 'ghost'} onClick={() => setStructureView('diagram')} aria-pressed={structureView === 'diagram'}><Network className='mr-2 h-4 w-4' />{t('workspaceUi.diagram')}</Button>{canEdit && structureView === 'diagram' && <><Button size='icon' variant='ghost' disabled={!undoStack.length} onClick={undo} aria-label={t('action.undo')}><Undo2 className='h-4 w-4' /></Button><Button size='icon' variant='ghost' disabled={!redoStack.length} onClick={redo} aria-label={t('action.redo')}><Redo2 className='h-4 w-4' /></Button><Button size='icon' variant='ghost' onClick={autoLayout} aria-label={t('action.autoLayout')}><LayoutDashboard className='h-4 w-4' /></Button></>}</div><div className='flex items-center gap-2'>{canEdit && <Button size='sm' variant='outline' onClick={() => setRelationOpen(true)}>{t('relation.add')}</Button>}{canEdit && <Button size='sm' onClick={() => setConceptOpen(true)}><Plus className='mr-1.5 h-4 w-4' />{t('concept.add')}</Button>}</div></div>}
          {mode === 'structure' && structureView === 'list' && <div className='relative flex min-h-0 flex-1 flex-col md:flex-row'><ObjectNavigator /><SemanticModelInspector modelId={modelId!} canEdit={canEdit} knowledge={knowledge} knowledgeOpen={knowledgeOpen} knowledgeTargetId={knowledgeTargetId} onKnowledgeClose={closeKnowledge} onMapData={(target) => void openMappingTarget(target)} workspace /></div>}
          {mode === 'structure' && structureView === 'diagram' && <div className='relative min-h-0 flex-1'><SemanticModelCanvas
            sourceMappings={sourceMappings.data}
            mappingHealth={mappingHealth.data?.items}
            canEdit={canEdit}
            knowledge={knowledge}
            onOpenKnowledge={(nodeId) => openKnowledge(nodeId)}
            onConnectRequest={(connection) => {
              setRelationConnection(connection);
              setRelationOpen(true);
            }}
            onMapStructuredDrop={(resource, nodeId) => void openMappingTarget(sourceMappingTargetFromResource(resource, nodeId))}
          /></div>}
          {mode === 'records' && modelId && <SemanticDataPreview modelId={modelId} dataRevisionId={boundDataRevisionId} onDataRevision={setBoundDataRevisionId} />}
          {mode === 'mappings' && modelId && <SemanticMappingsView modelId={modelId} canEdit={canEdit} onOpenGraph={openGraphViewer} onPopulationAccepted={setPopulationJobId} onRepairMapping={(mapping) => void openMappingTarget({ workspaceId: mapping.workspaceId, documentId: mapping.documentId, documentName: mapping.documentName ?? mapping.documentId, assetKind: mapping.assetKind, mimeType: mapping.mimeType, path: mapping.documentPath, conceptId: mapping.conceptId, mapping })} onBulkEditMappings={(mapping) => void openMappingTarget({ workspaceId: mapping.workspaceId, documentId: mapping.documentId, documentName: mapping.documentName ?? mapping.documentId, assetKind: mapping.assetKind, mimeType: mapping.mimeType, path: mapping.documentPath, conceptId: mapping.conceptId, mapping, bulkEdit: true })} />}
          {mode === 'structure' && structureView === 'diagram' && canEdit && graph.nodes.length > 0 && (
            <div className="absolute bottom-5 right-5 z-10 flex gap-2">
              <Button
                size="lg"
                variant="outline"
                className="shadow-lg bg-background"
                onClick={openGraphViewer}
              >
                <Network className="mr-2 h-4 w-4" />
                {t('dataWorkflow.dataGraph')}
              </Button>
              <Button
                size="lg"
                className="shadow-lg"
                onClick={() => setValidateOpen(true)}
                disabled={buildActive || !canValidate}
                title={buildActive ? t("build.alreadyRunning") : !canValidate ? t("save.saving") : undefined}
              >
                <Zap className="mr-2 h-4 w-4" />
                {t("validate.button")}
              </Button>
            </div>
          )}
          {!graph.nodes.length && mode === "structure" && structureView === 'diagram' && (
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
        {population && <PopulationStartedPanel
          outcome={population}
          sourceMappings={sourceMappings.data ?? []}
          onClose={() => setPopulation(null)}
          onOpenHealth={() => { setPopulation(null); setTrustOpen(true); }}
        />}
        {trustOpen && modelId && !population && <SemanticTrustPanel
          modelId={modelId}
          canEdit={canEdit && pending.length === 0}
          validation={validation}
          canRunCheck={canValidate}
          checking={checking}
          onRunCheck={() => void validate()}
          onClose={() => setTrustOpen(false)}
        />}
        {mode === 'structure' && structureView === 'diagram' && !trustOpen && !population && <SemanticModelInspector modelId={modelId!} canEdit={canEdit} knowledge={knowledge} knowledgeOpen={knowledgeOpen} knowledgeTargetId={knowledgeTargetId} onKnowledgeClose={closeKnowledge} onMapData={(target) => void openMappingTarget(target)} />}
        {mode === 'mappings' && knowledgeOpen && <SemanticModelInspector modelId={modelId!} canEdit={canEdit} knowledge={knowledge} knowledgeOpen={knowledgeOpen} knowledgeTargetId={knowledgeTargetId} onKnowledgeClose={closeKnowledge} onMapData={(target) => void openMappingTarget(target)} />}
        {modelId && <SourceMappingDrawer modelId={modelId} target={mappingTarget} onClose={() => setMappingTarget(null)} />}
      </main>
      <AddConceptDialog open={conceptOpen} onOpenChange={setConceptOpen} />
      <AddRelationDialog
        open={relationOpen}
        onOpenChange={setRelationOpen}
        initialConnection={relationConnection}
      />
      <AddRecordDialog open={recordOpen} onOpenChange={setRecordOpen} />
      {modelId && (
        <SemanticModelValidateDialog
          open={validateOpen}
          onOpenChange={setValidateOpen}
          modelId={modelId}
          runtimeOwned={model.data?.executionOwner === 'runtime'}
          onPopulationStarted={(outcome) => { setPopulation(outcome); setPopulationJobId(outcome.jobId); setTrustOpen(false); }}
        />
      )}
      {modelId && (
        <SemanticModelGraphViewer
          open={graphViewerOpen}
          onClose={() => setGraphViewerOpen(false)}
          modelId={modelId}
          dataRevisionId={boundDataRevisionId}
          onDataRevision={setBoundDataRevisionId}
          canEdit={canEdit}
        />
      )}
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
