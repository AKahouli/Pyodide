import { useCallback, useEffect, useRef, useState } from "react";
import { SuggestConceptsDialog, type SuggestionSource } from '../components/editor/SuggestConceptsDialog';
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  ChevronDown,
  History,
  Keyboard,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Network,
  Play,
  Plus,
  Redo2,
  Save,
  Sheet,
  Sparkles,
  Spline,
  Table2,
  Undo2,
  Workflow,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { SemanticModelInspector } from "../components/editor/SemanticModelInspector";
import { SemanticModelGraphViewer } from "../components/editor/SemanticModelGraphViewer";
import { SemanticModelValidateDialog } from "../components/editor/SemanticModelValidateDialog";
import { SourceMappingDrawer, sourceMappingTargetFromResource, type SourceMappingTarget } from "../components/mapping/SourceMappingDrawer";
import { SemanticMappingsView } from '../components/mapping/SemanticMappingsView';
import { SemanticDataPreview } from '../components/preview/SemanticDataPreview';
import { SemanticTrustPanel } from '../components/review/SemanticTrustPanel';
import { PopulationStartedPanel, type PopulationOutcome } from '../components/population/PopulationStartedPanel';
import { VersionsPanel } from "../components/versions/VersionsPanel";
import { useKnowledgeLinking, type KnowledgeResource } from "../hooks/use-knowledge-linking";
import { useMappingHealth, useSemanticDataPreview, useSemanticGraph, useSemanticModel, useReviewQueue, useSourceMappings } from "../query/hooks";
import { semanticModelQueryKeys } from '../query/queryKeys';
import { isPendingSaveCurrent, isSemanticGraphSaved, selectPendingOperations, useSemanticModelEditorStore } from "../store";
import type { ConceptSourceMapping } from "../types";
import type { DesignerSource } from "../utils/designer-flow";
import { layoutStructure } from "../utils/model-utils";

function apiCode(error: unknown): string | undefined {
  return parseApiError(error).code;
}

function mappingTarget_(mapping: ConceptSourceMapping): SourceMappingTarget {
  return { workspaceId: mapping.workspaceId, documentId: mapping.documentId, documentName: mapping.documentName ?? mapping.documentId, assetKind: mapping.assetKind, mimeType: mapping.mimeType, path: mapping.documentPath, conceptId: mapping.conceptId, mapping };
}

const POPULATION_TERMINAL_STATES = new Set(['completed', 'completed_with_gaps', 'failed', 'cancelled', 'superseded']);

export function SemanticModelEditorPage() {
  const { modelId } = useParams();
  const { t } = useModuleTranslation("semantic-model");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const model = useSemanticModel(modelId);
  const graphQuery = useSemanticGraph(modelId);
  const reviewQueue = useReviewQueue(modelId);
  const knowledge = useKnowledgeLinking(modelId);
  const sourceMappings = useSourceMappings(modelId);
  const mappingHealth = useMappingHealth(sourceMappings.data?.length ? modelId : undefined);
  const graph = useSemanticModelEditorStore((state) => state.graph);
  // Records for the status line; only asked once something can produce them.
  const designerRecords = useSemanticDataPreview(modelId, 10, Boolean(sourceMappings.data?.length || graph?.records.length));
  const mode = useSemanticModelEditorStore((state) => state.mode);
  const pending = useSemanticModelEditorStore((state) => state.pending);
  const saveStatus = useSemanticModelEditorStore((state) => state.saveStatus);
  const saveAttempt = useSemanticModelEditorStore((state) => state.saveAttempt);
  const validation = useSemanticModelEditorStore((state) => state.validation);
  const selectedId = useSemanticModelEditorStore((state) => state.selectedId);
  const select = useSemanticModelEditorStore((state) => state.select);
  const focus = useSemanticModelEditorStore((state) => state.focus);
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
  // null = closed; a source = suggest from that file; 'pick' = let the user choose a spreadsheet.
  const [suggestSource, setSuggestSource] = useState<SuggestionSource | 'pick' | null>(null);
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
    if (['completed', 'completed_with_gaps'].includes(populationJob.data.state)) {
      setBoundDataRevisionId(undefined);
      // Drop, not just invalidate: cached data would re-pin the replaced revision.
      queryClient.removeQueries({ queryKey: ['semantic-models', 'data-preview', modelId] });
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId ?? 'none') });
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.reviewQueue(modelId ?? 'none') });
    }
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
  const knowledgeClosedAtRef = useRef(0);
  const blocker = useBlocker(pending.length > 0);
  const canEdit =
    model.data?.status !== "archived" &&
    model.data?.role !== "viewer" &&
    Boolean(model.data?.currentDraftVersionId);
  const canValidate = canEdit && isSemanticGraphSaved({ graph, pending, saveStatus });
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
  const conceptCount = graph.nodes.filter((node) => !node.systemKey).length;
  const hasSources = (sourceMappings.data?.length ?? 0) > 0 || graph.records.length > 0;
  const recordCount = designerRecords.data?.summary.entities;
  const reviewCount = reviewQueue.data?.count ?? 0;
  const published = Boolean(model.data?.currentPublishedVersionId);
  const repairMapping = (mappingId: string) => {
    const mapping = sourceMappings.data?.find((candidate) => candidate.id === mappingId);
    if (!mapping) { setMode('mappings'); return; }
    void openMappingTarget(mappingTarget_(mapping));
  };
  const openGraphViewer = () => {
    setGraphViewerOpen(true);
  };
  const closeSidePanels = () => { setTrustOpen(false); setVersionsOpen(false); setPopulation(null); };
  const openSource = (source: DesignerSource, mapping?: ConceptSourceMapping) => {
    if (source.kind === 'typed') { setMode('records'); return; }
    const chosen = mapping ?? source.mappings[0];
    if (chosen) void openMappingTarget(mappingTarget_(chosen));
  };
  const dropOnCanvas = (resource: KnowledgeResource) => {
    // A mappable file dropped on empty canvas becomes a source; the drawer asks which concept it feeds.
    if (resource.kind === 'document' && resource.mappable) void openMappingTarget(sourceMappingTargetFromResource(resource));
    else openKnowledge();
  };
  const palette: Array<{ key: string; icon: typeof Plus; label: string; hint: string; onClick: () => void }> = [
    { key: 'source', icon: Sheet, label: t('designer.palette.source'), hint: t('designer.palette.sourceHint'), onClick: () => { closeSidePanels(); openKnowledge(); } },
    { key: 'typed', icon: Keyboard, label: t('designer.palette.typed'), hint: t('designer.palette.typedHint'), onClick: () => setRecordOpen(true) },
    { key: 'concept', icon: Box, label: t('designer.palette.concept'), hint: t('designer.palette.conceptHint'), onClick: () => setConceptOpen(true) },
    { key: 'relation', icon: Spline, label: t('designer.palette.relation'), hint: t('designer.palette.relationHint'), onClick: () => setRelationOpen(true) },
    { key: 'suggest', icon: Sparkles, label: t('designer.palette.suggest'), hint: t('designer.palette.suggestHint'), onClick: () => setSuggestSource('pick') },
  ];
  const onCanvas = mode === 'structure';
  return (
    <div className="flex h-[100dvh] w-full min-w-0 max-w-full flex-col overflow-hidden bg-muted/15">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
        <Button size="icon" variant="ghost" asChild aria-label={t("editor.back")}>
          <Link to="/semantic-models"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="mr-1 min-w-0">
          <h1 className="max-w-48 truncate text-sm font-semibold sm:max-w-80">{model.data?.name}</h1>
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            {t(model.data?.kind === "workspace_default" ? "editor.automaticModel" : "editor.designedModel")}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px]">
          <Save className={`h-3.5 w-3.5 ${saveStatus === "saving" ? "animate-pulse text-primary" : saveStatus === "conflict" || saveStatus === "error" ? "text-destructive" : "text-muted-foreground"}`} />
          {statusLabel}
          {(saveStatus === "error" || saveStatus === "offline") && (
            <button type="button" className="ml-1 font-semibold text-primary underline-offset-2 hover:underline" onClick={retrySave}>{t("action.retry")}</button>
          )}
        </div>
        {canEdit && onCanvas && <div className='hidden items-center sm:flex'>
          <Button size='icon' variant='ghost' disabled={!undoStack.length} onClick={undo} aria-label={t('action.undo')}><Undo2 className='h-4 w-4' /></Button>
          <Button size='icon' variant='ghost' disabled={!redoStack.length} onClick={redo} aria-label={t('action.redo')}><Redo2 className='h-4 w-4' /></Button>
          <Button size='icon' variant='ghost' onClick={autoLayout} aria-label={t('action.autoLayout')}><LayoutDashboard className='h-4 w-4' /></Button>
        </div>}
        <div className="flex-1" />
        {/* One line that says where the model stands, instead of steps and percentages. */}
        <p className="hidden text-xs text-muted-foreground lg:block" aria-live="polite">
          {t(published ? 'designer.status.published' : 'designer.status.draft')}
          {recordCount !== undefined && <> · {t('editor.recordCount', { count: recordCount })}</>}
          {reviewCount > 0 && <> · <span className="text-amber-700 dark:text-amber-400">{t(reviewCount === 1 ? 'designer.status.issues_one' : 'designer.status.issues_other', { count: reviewCount })}</span></>}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {!onCanvas && <Button size='sm' variant='outline' onClick={() => setMode('structure')}><Workflow className='mr-1.5 h-4 w-4' />{t('designer.backToCanvas')}</Button>}
          {onCanvas && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size='sm' variant='ghost'><Table2 className='mr-1.5 h-4 w-4' />{t('designer.data')}<ChevronDown className='ml-1 h-3.5 w-3.5' /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onSelect={() => setMode('records')}><Table2 className='h-4 w-4' />{t('mode.records')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={openGraphViewer}><Network className='h-4 w-4' />{t('dataWorkflow.dataGraph')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMode('mappings')}><ListChecks className='h-4 w-4' />{t('designer.sourceList')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          <Button variant='ghost' size='sm' onClick={() => { setKnowledgeOpen(false); setPopulation(null); setVersionsOpen(false); setTrustOpen((open) => !open); }}>
            {t('reviewQueue.button')}
            {reviewCount > 0 && <span className='ml-2 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300' aria-label={t('reviewQueue.badge', { count: reviewCount })}>{reviewCount}</span>}
          </Button>
          <Button variant='ghost' size='sm' onClick={() => { setKnowledgeOpen(false); setTrustOpen(false); setVersionsOpen((open) => !open); }} aria-label={t('designer.versions')}><History className='h-4 w-4' /></Button>
          {canEdit && <Button variant='outline' size='sm' disabled={!canValidate || Boolean(populationJobId)} onClick={() => setValidateOpen(true)}>
            {populationJobId ? <Loader2 className='mr-1.5 h-4 w-4 animate-spin' /> : <Play className='mr-1.5 h-4 w-4' />}
            {t(populationJobId ? 'designer.running' : 'designer.run')}
          </Button>}
          {canEdit && <Button size='sm' onClick={() => { setKnowledgeOpen(false); setTrustOpen(false); setVersionsOpen(true); }}>{t('workspaceUi.publishShort')}</Button>}
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
        {onCanvas && canEdit && <nav aria-label={t('designer.palette.title')} className='hidden w-44 shrink-0 flex-col gap-1.5 overflow-y-auto border-r bg-background p-3 md:flex'>
          <p className='px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>{t('designer.palette.title')}</p>
          {palette.map((item) => <button key={item.key} type='button' onClick={item.onClick} title={item.hint} className='flex items-center gap-2 rounded-xl border bg-card px-2.5 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5'>
            <item.icon className={`h-4 w-4 shrink-0 ${item.key === 'source' || item.key === 'typed' ? 'text-teal-600 dark:text-teal-400' : 'text-primary'}`} />
            <span className='min-w-0 truncate'>{item.label}</span>
          </button>)}
          <p className='mt-2 px-1 text-[11px] leading-snug text-muted-foreground'>{t('designer.palette.help')}</p>
        </nav>}
        <section className="relative flex min-w-0 flex-1 flex-col">
          {onCanvas && <div className='relative min-h-0 flex-1'><SemanticModelCanvas
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
            onOpenSource={openSource}
            onPaneDrop={dropOnCanvas}
            onAddFeed={(source) => { const first = source.mappings[0]; if (first) void openMappingTarget({ ...mappingTarget_(first), mapping: undefined, conceptId: undefined }); }}
          /></div>}
          {mode === 'records' && modelId && <SemanticDataPreview modelId={modelId} dataRevisionId={boundDataRevisionId} onDataRevision={setBoundDataRevisionId} onOpenItem={(id) => { setMode('structure'); focus(id); }} canEdit={canEdit} onRebuildStarted={setPopulationJobId} />}
          {mode === 'mappings' && modelId && <SemanticMappingsView modelId={modelId} canEdit={canEdit} onOpenGraph={openGraphViewer} onPopulationAccepted={setPopulationJobId} onRepairMapping={(mapping) => void openMappingTarget(mappingTarget_(mapping))} onBulkEditMappings={(mapping) => void openMappingTarget({ ...mappingTarget_(mapping), bulkEdit: true })} />}
          {onCanvas && conceptCount === 0 && !hasSources && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              {/* Like the first step of a scenario: one big +, and the choices it opens. */}
              <div className="pointer-events-auto flex max-w-sm flex-col items-center text-center">
                {canEdit ? <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-dashed border-primary/50 bg-background text-primary transition hover:scale-105 hover:border-primary" aria-label={t('designer.empty.start')}>
                      <Plus className="h-12 w-12" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center">
                    <DropdownMenuItem className="min-h-11" onSelect={() => openKnowledge()}><Sheet className="h-4 w-4" />{t('designer.palette.source')}</DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" onSelect={() => setConceptOpen(true)}><Box className="h-4 w-4" />{t('designer.palette.concept')}</DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" onSelect={() => setSuggestSource('pick')}><Sparkles className="h-4 w-4" />{t('suggest.open')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu> : <Workflow className="h-10 w-10 text-primary" />}
                <h2 className="mt-4 font-semibold">{t("designer.empty.title")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("designer.empty.description")}</p>
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
          onRepairMapping={(mappingId) => { setTrustOpen(false); repairMapping(mappingId); }}
          onOpenItem={(id) => { setMode('structure'); focus(id); }}
          onFixValues={() => setMode('records')}
        />}
        {(onCanvas || knowledgeOpen) && !trustOpen && !population && <SemanticModelInspector modelId={modelId!} canEdit={canEdit} knowledge={knowledge} knowledgeOpen={knowledgeOpen} knowledgeTargetId={knowledgeTargetId} onKnowledgeClose={closeKnowledge} onMapData={(target) => void openMappingTarget(target)} />}
        {modelId && <SourceMappingDrawer modelId={modelId} target={mappingTarget} onClose={() => setMappingTarget(null)} onSuggestConcepts={canEdit ? (source) => { setMappingTarget(null); setSuggestSource(source); } : undefined} />}
      </main>
      <AddConceptDialog open={conceptOpen} onOpenChange={setConceptOpen} />
      {modelId && canEdit && <SuggestConceptsDialog modelId={modelId} open={suggestSource !== null} onOpenChange={(open) => { if (!open) setSuggestSource(null); }} source={suggestSource === 'pick' ? null : suggestSource} />}
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
          onRebuildStarted={setPopulationJobId}
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
