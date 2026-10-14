import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SuggestConceptsDialog, type SuggestionSource } from '../components/editor/SuggestConceptsDialog';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListOrdered,
  AlertTriangle,
  ArrowLeft,
  Box,
  ChevronDown,
  History,
  LayoutDashboard,
  HeartPulse,
  ListChecks,
  Loader2,
  Network,
  PanelRightOpen,
  Play,
  Plus,
  Redo2,
  Save,
  Sheet,
  Sparkles,
  Spline,
  StopCircle,
  RotateCcw,
  Table2,
  Undo2,
  Workflow,
  X,
  Trash2,
  Copy,
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useOptionalSidebar } from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CloneSemanticModelDialog } from "../components/catalog/CloneSemanticModelDialog";
import { DeleteSemanticModelDialog } from "../components/catalog/DeleteSemanticModelDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { showError, showSuccess } from "@/lib/notifications";
import { apiErrorDetails, parseApiError } from "@/lib/api-error";
import { useModuleTranslation } from "@/modules/localization";
import { cn } from '@/lib/utils';
import { announceUndoable, isTextEntry } from '../utils/undo-notice';
import { semanticModelApi } from "../api";
import {
  AddConceptDialog,
  AddRelationDialog,
  ManualTableDialog,
} from "../components/editor/EditorDialogs";
import { SemanticModelCanvas } from "../components/editor/SemanticModelCanvas";
import { SemanticModelInspector } from "../components/editor/SemanticModelInspector";
import { ConceptRecordsPanel } from "../components/records/ConceptRecordsPanel";
import { ManualTableEditor } from "../components/records/ManualTableEditor";
import { SemanticModelGraphViewer } from "../components/editor/SemanticModelGraphViewer";
import { SemanticModelValidateDialog } from "../components/editor/SemanticModelValidateDialog";
import { ConceptRefreshDialog } from "../components/records/ConceptRefreshDialog";
import { SourceMappingDrawer, sourceMappingTargetFromResource, sourceMappingTargetFromWorkspace, type SourceMappingTarget } from "../components/mapping/SourceMappingDrawer";
import { DerivedSourceDrawer, type DerivedSourceTarget } from "../components/mapping/DerivedSourceDrawer";
import { SourceSuggestionsList, takeChosenSource, useSourceSuggestions } from '../components/assistant/SourceSuggestions';
import { SourceChooserDialog } from '../components/assistant/SourceChooser';
import type { SourceSuggestion, SourceSuggestionOption } from "../types";
import { SemanticMappingsView } from '../components/mapping/SemanticMappingsView';
import { SemanticDataPreview, type DataPreviewFocus } from '../components/preview/SemanticDataPreview';
import { ReviewFocusBar } from '../components/review/ReviewFocusBar';
import { CanvasPalette } from '../components/editor/CanvasPalette';
import { ModelHealthView } from '../components/health/ModelHealthView';
import { ModelSetupChecks } from '../components/health/ModelSetupChecks';
import { conceptsRefreshedWith } from '../components/population/runScope';
import { PopulationStartedPanel, populationServing, runCanStop, type PopulationOutcome } from '../components/population/PopulationStartedPanel';
import { RunHistoryPanel } from '../components/population/RunHistoryPanel';
import { MyJobsButton } from '../components/population/MyJobsDrawer';
import { SearchIndexPanel } from '../components/population/SearchIndexPanel';
import { useAfterDelay } from '../hooks/use-after-delay';
import { GraphStatusTooltip } from '../components/population/GraphStatusTooltip';
import { VersionsPanel } from "../components/versions/VersionsPanel";
import { useKnowledgeLinking, type KnowledgeResource } from "../hooks/use-knowledge-linking";
import { useAssistantSync } from "../hooks/use-assistant-sync";
import { isIndexBuilding, useCanvasPositions, useDerivedSources, useIdentityRules, useMappingHealth, useModelCheck, usePopulationFreshness, useSearchIndexStatus, useSemanticVersions, useVersionComparison, useSemanticDataPreview, useSemanticGraph, useSemanticModel, useModelHealth, useSourceMappings } from "../query/hooks";
import { semanticModelQueryKeys } from '../query/queryKeys';
import { isPendingSaveCurrent, isSemanticGraphSaved, selectPendingOperations, useSemanticModelEditorStore } from "../store";
import type { ConceptSourceMapping, HealthAction, ModelCheckIssue, ReviewQueueItem } from "../types";
import { checkBlockReason, checkTarget } from "../utils/model-check";
import type { DesignerSource } from "../utils/designer-flow";
import { layoutStructure } from "../utils/model-utils";

function apiCode(error: unknown): string | undefined {
  return parseApiError(error).code;
}

function mappingTarget_(mapping: ConceptSourceMapping): SourceMappingTarget {
  return { workspaceId: mapping.workspaceId, documentId: mapping.documentId, documentName: mapping.documentName ?? mapping.documentId, assetKind: mapping.assetKind, mimeType: mapping.mimeType, path: mapping.documentPath, conceptId: mapping.conceptId, mapping };
}

const POPULATION_TERMINAL_STATES = new Set(['completed', 'completed_with_gaps', 'failed', 'cancelled', 'superseded']);
/** A stop pending this long is told apart from a normal one: its worker may be gone, and ends only when its lease runs out. */
const STOP_SLOW_MS = 60_000;

export function SemanticModelEditorPage() {
  const { modelId } = useParams();
  const { t } = useModuleTranslation("semantic-model");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const model = useSemanticModel(modelId);
  const [deleteModelOpen, setDeleteModelOpen] = useState(false);
  const [cloneModelOpen, setCloneModelOpen] = useState(false);
  const graphQuery = useSemanticGraph(modelId);
  const modelHealth = useModelHealth(modelId);
  const knowledge = useKnowledgeLinking(modelId);
  const sourceMappings = useSourceMappings(modelId);
  const identityRules = useIdentityRules(modelId);
  const derivedSources = useDerivedSources(modelId);
  const canvasPositions = useCanvasPositions(modelId);
  // What publishing would change, so Publish can say when there is something to publish.
  const versionList = useSemanticVersions(modelId).data ?? [];
  const draftVersionId = versionList.find((version) => version.status === 'draft')?.id;
  const publishedVersionId = versionList.find((version) => version.status === 'published')?.id;
  const publishComparison = useVersionComparison(modelId, publishedVersionId, draftVersionId);
  const mappingHealth = useMappingHealth(sourceMappings.data?.length ? modelId : undefined);
  const graph = useSemanticModelEditorStore((state) => state.graph);
  // Records for the status line; only asked once something can produce them.
  const freshness = usePopulationFreshness(modelId, Boolean(sourceMappings.data?.length || graph?.records.length));
  const modelCheck = useModelCheck(modelId);
  // A check that could not be read blocks nothing: Run and Publish fail open.
  const checkResult = modelCheck.isError ? undefined : modelCheck.data;
  const designerRecords = useSemanticDataPreview(modelId, 10, Boolean(sourceMappings.data?.length || graph?.records.length));
  // Stable between renders: the canvas rebuilds its boxes when these change.
  const conceptRecordCounts = useMemo(() => {
    const concepts = designerRecords.data?.concepts;
    return concepts?.some((concept) => concept.total !== undefined)
      ? Object.fromEntries(concepts.map((concept) => [concept.id, concept.total ?? concept.entities.length]))
      : undefined;
  }, [designerRecords.data]);
  const conceptLabels = useMemo(() => Object.fromEntries((graph?.nodes ?? []).map((node) => [node.id, node.label])), [graph?.nodes]);
  const sourcePositions = useMemo(() => Object.fromEntries((canvasPositions.data ?? []).map((item) => [item.id, { x: item.x, y: item.y }])), [canvasPositions.data]);
  const mode = useSemanticModelEditorStore((state) => state.mode);
  const pending = useSemanticModelEditorStore((state) => state.pending);
  const saveStatus = useSemanticModelEditorStore((state) => state.saveStatus);
  const saveAttempt = useSemanticModelEditorStore((state) => state.saveAttempt);
  const validation = useSemanticModelEditorStore((state) => state.validation);
  const selectedId = useSemanticModelEditorStore((state) => state.selectedId);
  const detailsOpen = useSemanticModelEditorStore((state) => state.detailsOpen);
  const select = useSemanticModelEditorStore((state) => state.select);
  const focus = useSemanticModelEditorStore((state) => state.focus);
  const suggestIdentity = useSemanticModelEditorStore((state) => state.suggestIdentity);
  const focusRequest = useSemanticModelEditorStore((state) => state.focusRequest);
  const selectionTick = useSemanticModelEditorStore((state) => state.selectionTick);
  const undoStack = useSemanticModelEditorStore((state) => state.undoStack);
  const redoStack = useSemanticModelEditorStore((state) => state.redoStack);
  const historyBusy = useSemanticModelEditorStore((state) => state.historyBusy);
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
  // The model check follows the model: asked again shortly after the last edit, save or source change.
  const checkTimerRef = useRef<number>();
  const refreshModelCheck = useCallback(() => {
    if (!modelId) return;
    window.clearTimeout(checkTimerRef.current);
    checkTimerRef.current = window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.modelCheck(modelId) }), 800);
  }, [modelId, queryClient]);
  useEffect(() => () => window.clearTimeout(checkTimerRef.current), []);
  const checkSeenRef = useRef(false);
  useEffect(() => {
    // The first read is already the current one.
    if (!checkSeenRef.current) { checkSeenRef.current = true; return; }
    if (saveStatus === "saved") refreshModelCheck();
  }, [graph?.revision, saveStatus, sourceMappings.dataUpdatedAt, identityRules.dataUpdatedAt, derivedSources.dataUpdatedAt, refreshModelCheck]);
  const [conceptOpen, setConceptOpen] = useState(false);
  // null = closed; a source = suggest from that file; 'pick' = let the user choose a spreadsheet.
  const [suggestSource, setSuggestSource] = useState<SuggestionSource | 'pick' | null>(null);
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationConnection, setRelationConnection] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);
  // The manual table: which concept's grid is open, and the dialog that asks which concept when none is selected.
  const [manualConceptId, setManualConceptId] = useState<string | null>(null);
  const [manualPickOpen, setManualPickOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeTargetId, setKnowledgeTargetId] = useState<string | null>(null);
  // Switching a source: the knowledge list picks the new one, then each of its mappings opens in turn on it.
  const [switching, setSwitching] = useState<{ label: string; mappings: ConceptSourceMapping[] } | null>(null);
  const switchQueue = useRef<{ base: SourceMappingTarget; rest: ConceptSourceMapping[]; switched: string[] } | null>(null);
  const nextSwitch = useRef<SourceMappingTarget | null>(null);
  // The knowledge list closed some other way (another concept picked): it no longer picks a source to switch to.
  useEffect(() => { if (!knowledgeOpen) setSwitching(null); }, [knowledgeOpen]);
  // The concept whose records are shown in the table under the canvas.
  const [recordsConceptId, setRecordsConceptId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const [refreshConceptId, setRefreshConceptId] = useState<string | null>(null);
  const [graphViewerOpen, setGraphViewerOpen] = useState(false);
  const [boundDataRevisionId, setBoundDataRevisionId] = useState<string>();
  const [populationJobId, setPopulationJobId] = useState<string>();
  // The concepts the running job refreshes; null when it covers the whole model or its scope is unknown.
  const [runConceptIds, setRunConceptIds] = useState<string[] | null>(null);
  const [runHistoryOpen, setRunHistoryOpen] = useState(false);
  const [population, setPopulation] = useState<PopulationOutcome | null>(null);
  // The last update followed on this page, kept when its panel is closed so its result can be shown again.
  const [lastRun, setLastRun] = useState<PopulationOutcome | null>(null);
  // The panel of a search index build that no update is attached to.
  const [indexPanelOpen, setIndexPanelOpen] = useState(false);
  const runPanelOpen = Boolean(population) || indexPanelOpen;
  const closeRunPanel = () => { setPopulation(null); setIndexPanelOpen(false); };
  const [stoppingRun, setStoppingRun] = useState(false);
  // What the person is asked to confirm stopping: the data update, or the build of the search index.
  const [confirmStop, setConfirmStop] = useState<'run' | 'queued' | 'index' | null>(null);
  const [stoppingIndex, setStoppingIndex] = useState(false);
  const [restartingIndex, setRestartingIndex] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // The review item being fixed, and the records to show for a missing value.
  const [reviewFocus, setReviewFocus] = useState<ReviewQueueItem | null>(null);
  const [dataFocus, setDataFocus] = useState<DataPreviewFocus | null>(null);
  const [choosingFor, setChoosingFor] = useState<SourceSuggestion | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceSuggestions = useSourceSuggestions(modelId);
  const suggestionList = sourceSuggestions.data?.suggestions ?? [];
  const pendingSuggestions = suggestionList.filter((suggestion) => suggestion.status === 'pending').length;
  useEffect(() => setBoundDataRevisionId(undefined), [modelId]);
  const populationJob = useQuery({
    queryKey: ['semantic-models', 'population-job', modelId, populationJobId],
    queryFn: () => semanticModelApi.getPopulationJob(modelId!, populationJobId!),
    enabled: Boolean(modelId && populationJobId),
    // Every second while it runs, so its progress reads as live.
    refetchInterval: (query) => POPULATION_TERMINAL_STATES.has(query.state.data?.state ?? '') ? false : 1000,
    // Keep following a run while the tab is in the background, so the result is there on return.
    refetchIntervalInBackground: true,
    retry: false,
  });
  useEffect(() => {
    if (!populationJob.data || !POPULATION_TERMINAL_STATES.has(populationJob.data.state)) return;
    if (['completed', 'completed_with_gaps'].includes(populationJob.data.state)) {
      setBoundDataRevisionId(undefined);
      // Drop, not just invalidate: cached data would re-pin the replaced revision.
      queryClient.removeQueries({ queryKey: ['semantic-models', 'data-preview', modelId] });
      void queryClient.invalidateQueries({ queryKey: ['semantic-models', 'concept-records', modelId] });
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId ?? 'none') });
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.reviewQueue(modelId ?? 'none') });
    }
    void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.freshness(modelId ?? 'none') });
    // Hand the final state to the run panel before we stop following the job, or it spins forever.
    const finalState = populationJob.data.state;
    const finalProgress = populationJob.data.progress;
    const finalServing = populationServing(populationJob.data.result);
    const finalError = populationJob.data.errorCode;
    const finished = (current: PopulationOutcome | null) => current && current.jobId === populationJobId
      ? { ...current, status: finalState, progress: finalProgress ?? current.progress, serving: finalServing ?? current.serving, errorCode: finalError ?? current.errorCode } : current;
    setPopulation(finished);
    setLastRun(finished);
    setPopulationJobId(undefined);
  }, [populationJob.data]);
  useEffect(() => { if (population) { setLastRun(population); setIndexPanelOpen(false); } }, [population]);
  const [mappingTarget, setMappingTarget] = useState<SourceMappingTarget | null>(null);
  const [derivedTarget, setDerivedTarget] = useState<DerivedSourceTarget | null>(null);
  // The mapping drawers share the right edge with the manual table: opening one closes the other.
  useEffect(() => { if (mappingTarget || derivedTarget) setManualConceptId(null); }, [mappingTarget, derivedTarget]);
  const openDerived = (target: DerivedSourceTarget) => { setMappingTarget(null); if (knowledgeOpen) closeKnowledge(); setDerivedTarget(target); };
  const adoptRevision = useSemanticModelEditorStore((state) => state.adoptRevision);
  const pushAction = useSemanticModelEditorStore((state) => state.pushAction);
  // Removing a source happens at once, without asking: Undo puts it back with the same settings.
  const removeSource = useCallback(async (label: string, removed: ConceptSourceMapping[]) => {
    if (!modelId || !removed.length) return;
    const refresh = () => Promise.all([
      queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceMappings(modelId) }),
      queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.mappingHealth(modelId) }),
      queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
      queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.freshness(modelId) }),
    ]).then(() => refreshModelCheck());
    // Put back, a source gets a new id; follow it so Redo removes the right one.
    let live = removed;
    const remove = async () => {
      try {
        for (const mapping of live) adoptRevision((await semanticModelApi.deleteSourceMapping(modelId, mapping.id)).revision);
      } finally {
        void refresh();
      }
    };
    const restore = async () => {
      try {
        for (const mapping of live) {
          const result = mapping.scope === 'workspace'
            ? await semanticModelApi.createWorkspaceSourceMapping(modelId, {
              conceptId: mapping.conceptId, workspaceId: mapping.workspaceId,
              folderIds: mapping.selection?.folderIds ?? (mapping.folderId ? [mapping.folderId] : []),
              documentIds: mapping.selection?.documentIds ?? [],
              fieldMappings: mapping.fieldMappings, identityFields: mapping.identityFields,
            })
            : await semanticModelApi.createSourceMapping(modelId, {
              conceptId: mapping.conceptId, workspaceId: mapping.workspaceId, documentId: mapping.documentId,
              sheetName: mapping.sheetName, assetKind: mapping.assetKind, fieldMappings: mapping.fieldMappings, identityFields: mapping.identityFields,
            });
          adoptRevision(result.revision);
        }
        const current = await semanticModelApi.listSourceMappings(modelId);
        live = live.map((mapping) => current.find((item) => item.conceptId === mapping.conceptId && item.documentId === mapping.documentId && item.sheetName === mapping.sheetName) ?? mapping);
      } finally {
        void refresh();
      }
    };
    const reported = (step: () => Promise<void>, message: string) => async () => {
      try { await step(); } catch (error) { showError(message, { description: parseApiError(error).message }); throw error; }
    };
    try {
      await remove();
    } catch (error) {
      showError(t('designer.delete.sourceError'), { description: parseApiError(error).message });
      return;
    }
    pushAction({ undo: reported(restore, t('designer.undo.restoreError')), redo: reported(remove, t('designer.delete.sourceError')) });
    announceUndoable(t('designer.delete.sourceDone', { name: label }), t('action.undo'));
  }, [adoptRevision, modelId, pushAction, queryClient, refreshModelCheck, t]);
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
      setDerivedTarget(null);
      setMappingTarget(target);
    } catch (error) {
      showError(t('sourceAnalysis.error'), { description: error instanceof Error ? error.message : undefined });
    }
  }, [knowledge.workspaceLinks, modelId, queryClient, t]);
  const savingRef = useRef(false);
  // A save refused because the model changed meanwhile is replayed once on the new revision.
  const conflictRetryRef = useRef(0);
  const { activeRun } = useAssistantSync(modelId);
  // A data update started from a conversation (or another tab) shows here once, with Stop.
  const adoptedRunsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!activeRun || adoptedRunsRef.current.has(activeRun.jobId) || populationJobId === activeRun.jobId) return;
    adoptedRunsRef.current.add(activeRun.jobId);
    setRunConceptIds(null);
    setPopulationJobId(activeRun.jobId);
    setSuggestionsOpen(false);
    setPopulation((current) => current?.jobId === activeRun.jobId ? current : { jobId: activeRun.jobId, status: activeRun.state, skipped: [], reused: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun?.jobId]);
  // A source saved for a concept answers its suggestion.
  useEffect(() => {
    if (modelId) void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceSuggestions(modelId) });
  }, [modelId, queryClient, sourceMappings.data]);
  const hydratedVersionRef = useRef<string | null>(null);
  const knowledgeClosedAtRef = useRef(0);
  const blocker = useBlocker(pending.length > 0);
  const canEdit =
    model.data?.status !== "archived" &&
    model.data?.role !== "viewer" &&
    Boolean(model.data?.currentDraftVersionId);
  const canValidate = canEdit && isSemanticGraphSaved({ graph, pending, saveStatus });
  // Anything the model is busy with shows in the header as Stop: a data update (every phase) or the search index being built.
  const indexStatus = useSearchIndexStatus(modelId, canEdit);
  const indexBuilding = canEdit && isIndexBuilding(indexStatus.data?.index.state);
  useEffect(() => { if (!indexBuilding) setStoppingIndex(false); }, [indexBuilding]);
  const runProgress = populationJob.data?.jobId === populationJobId ? populationJob.data?.progress : population?.progress;
  const runStoppable = runCanStop(runProgress);
  // A run followed from elsewhere (a conversation, another tab, the history) names its own concept in its progress.
  const refreshingConcepts: 'all' | string[] = runConceptIds
    ?? (runProgress?.scopeConceptId ? conceptsRefreshedWith(runProgress.scopeConceptId, derivedSources.data ?? []) : 'all');
  const runStopRequested = stoppingRun || populationJob.data?.state === 'cancel_requested';
  const stopPending = populationJobId ? runStopRequested : stoppingIndex;
  const stopSlow = useAfterDelay(Boolean(stopPending), STOP_SLOW_MS);
  // What the status button opens: the update being followed, else the index being built, else the last update seen.
  const statusTarget: 'run' | 'index' | 'last' | null = populationJobId ? 'run' : indexBuilding ? 'index' : lastRun || population || indexPanelOpen ? 'last' : null;
  const busy = Boolean(populationJobId) || indexBuilding;
  // The worker building the index stopped answering: Restart sits next to Stop.
  const indexStalled = !populationJobId && indexBuilding && Boolean(indexStatus.data?.index.stalled);
  const openRunStatus = () => {
    setSuggestionsOpen(false); setVersionsOpen(false); setRunHistoryOpen(false); setMappingTarget(null);
    if (populationJobId) {
      setPopulation((current) => current ?? { jobId: populationJobId, status: populationJob.data?.state ?? 'running', skipped: [], reused: false, progress: populationJob.data?.progress });
    } else if (indexBuilding || !lastRun) {
      setIndexPanelOpen(true);
    } else {
      setPopulation(lastRun);
    }
  };
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

  // Selecting something means "show me this", so its details take the side panel back. A review item
  // opened this way stays named in the bar above the work area, with the way back to the list.
  useEffect(() => {
    if (!selectedId) return;
    closeRunPanel();
    setSuggestionsOpen(false);
    setVersionsOpen(false);
    setMappingTarget(null);
    // The knowledge list belongs to the concept it was opened for; picking something else closes it.
    if (knowledgeTargetId !== selectedId) { setKnowledgeOpen(false); setKnowledgeTargetId(null); }
    // An open records table follows the concept being looked at.
    if (recordsConceptId && graph?.nodes.some((node) => node.id === selectedId && !node.systemKey)) setRecordsConceptId(selectedId);
  // Every click counts, including one on what is already selected, so the panel never stays on an earlier choice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, selectedId, selectionTick]);

  // A concept's properties open on the right; the app's left navigation folds away to leave the canvas room.
  const appSidebar = useOptionalSidebar();
  const setAppSidebarOpen = appSidebar?.setOpen;
  const conceptDetailsShown = detailsOpen && Boolean(selectedId && graph?.nodes.some((node) => node.id === selectedId));
  useEffect(() => {
    if (conceptDetailsShown) { setAppSidebarOpen?.(false); appSidebar?.setOpenMobile(false); }
  // Only opening a concept folds it; the user can unfold it again while the panel stays open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptDetailsShown, selectedId, selectionTick]);

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
        if (saveIsCurrent()) {
          conflictRetryRef.current = 0;
          markSaved(result.revision, batch.groupCount);
        }
      } catch (error) {
        if (saveIsCurrent()) {
          const apiError = parseApiError(error);
          if (apiError.code === "ERR_3703" && conflictRetryRef.current < 1) {
            // Someone else (an assistant, often) saved first: replay these edits on their version and save again.
            conflictRetryRef.current += 1;
            markFailed("error");
            try {
              useSemanticModelEditorStore.getState().rebase(await semanticModelApi.graph(modelId));
              savingRef.current = false;
              retrySave();
              return;
            } catch {
              // Fall through to the conflict dialog.
            }
          }
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
      setMode('health');
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
      // Escape closes the details panel, unless a dialog or a field has it.
      if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !isTextEntry(event.target)
        && !document.querySelector('[role="dialog"]') && useSemanticModelEditorStore.getState().detailsOpen) {
        useSemanticModelEditorStore.getState().openDetails(false);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      // Typing in a field keeps the field's own undo.
      if (isTextEntry(event.target) && event.key.toLowerCase() !== "s") return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        void redo();
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
  const browseRecords = useCallback((conceptId: string) => setRecordsConceptId(conceptId), []);
  const openKnowledge = (targetId:string|null=null) => {
    if (Date.now()-knowledgeClosedAtRef.current<700) return;
    setKnowledgeTargetId(targetId);
    setKnowledgeOpen(true);
    // The concept being fed is the one highlighted, so clicking another one moves on from it.
    if (targetId) select(targetId);
  };
  const closeKnowledge = () => {
    knowledgeClosedAtRef.current=Date.now();
    setKnowledgeOpen(false);
    setKnowledgeTargetId(null);
  };
  const stopRun = async (onlyQueued = false) => {
    if (!modelId || !population) return;
    setStoppingRun(true);
    try {
      const job = onlyQueued ? await semanticModelApi.stopMyJob(population.jobId, true)
        : await semanticModelApi.stopPopulationJob(modelId, population.jobId);
      setPopulation((current) => current && current.jobId === job.jobId ? { ...current, status: job.state } : current);
      void populationJob.refetch();
    } catch (error) {
      showError(t('runStop.error'), { description: parseApiError(error).message });
    } finally {
      setStoppingRun(false);
    }
  };
  const restartIndex = async () => {
    if (!modelId) return;
    setRestartingIndex(true);
    try {
      await semanticModelApi.restartSearchIndex(modelId);
      await queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.searchIndex(modelId).slice(0, 3) });
    } catch (error) {
      showError(t('runStop.indexRestartError'), { description: parseApiError(error).message });
    } finally {
      setRestartingIndex(false);
    }
  };
  const stopIndex = async () => {
    if (!modelId) return;
    setStoppingIndex(true);
    try {
      const stopped = await semanticModelApi.stopSearchIndex(modelId);
      // Nothing was building any more: the button follows the index status again.
      if (!stopped.stopped) setStoppingIndex(false);
      await queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.searchIndex(modelId).slice(0, 3) });
    } catch (error) {
      setStoppingIndex(false);
      showError(t('runStop.indexError'), { description: parseApiError(error).message });
    }
  };
  const confirmedStop = () => {
    const kind = confirmStop;
    setConfirmStop(null);
    if (kind === 'run') void stopRun();
    else if (kind === 'queued') void stopRun(true);
    else if (kind === 'index') void stopIndex();
  };
  const openSuggestions = () => { setKnowledgeOpen(false); closeRunPanel(); setVersionsOpen(false); setSuggestionsOpen(true); };
  const suggestionConcept = (suggestion: SourceSuggestion) =>
    graph?.nodes.find((node) => node.id === suggestion.conceptId) ?? graph?.nodes.find((node) => node.key === suggestion.conceptKey);
  // Using a suggestion opens the source picker with its files already picked: the person checks, then saves.
  const useSuggestion = (suggestion: SourceSuggestion, index: number) => openSourceOption(suggestion, suggestion.options[index]);
  const openSourceOption = (suggestion: SourceSuggestion, option: SourceSuggestionOption | undefined) => {
    const node = suggestionConcept(suggestion);
    if (!node || !option) { showError(t('assistantSources.openFailed')); return; }
    const single = option.kind === 'spreadsheet' || option.kind === 'document';
    const target: SourceMappingTarget = single
      ? {
        workspaceId: option.workspaceId, documentId: option.documentIds[0], documentName: option.documents[0] ?? '', conceptId: node.id, mimeType: option.mimeType,
        assetKind: option.kind === 'document' ? 'document' : option.mimeType?.includes('csv') ? 'csv' : 'excel_sheet',
      }
      : sourceMappingTargetFromWorkspace({
        workspaceId: option.workspaceId, workspaceName: option.workspaceName, folderIds: option.folderIds, documentIds: option.documentIds,
        name: option.kind === 'workspace' ? option.workspaceName : `${option.workspaceName} / ${[...option.folders, ...option.documents].join(', ')}`,
      }, node.id);
    select(node.id);
    void openMappingTarget(target);
  };
  // Choosing other files opens the list of every workspace, searchable, in front of everything else.
  const browseForSuggestion = (suggestion: SourceSuggestion) => {
    if (!suggestionConcept(suggestion)) { showError(t('assistantSources.openFailed')); return; }
    setChoosingFor(suggestion);
  };

  // A chat citation's "Open in graph": the graph opens on the record cited.
  const wantedRecord = searchParams.get('record');
  const [graphRecord, setGraphRecord] = useState<string | null>(null);
  useEffect(() => {
    if (!wantedRecord) return;
    setGraphRecord(wantedRecord);
    setGraphViewerOpen(true);
    setSearchParams((params) => { params.delete('record'); return params; }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedRecord]);
  const onGraphRecord = useCallback((found: boolean) => {
    setGraphRecord(null);
    if (!found) showError(t('citedRecord.graphRecordMissing'));
  }, [t]);

  const wantedSuggestion = searchParams.get('suggestion');
  const wantsSuggestions = searchParams.get('sources') === '1';
  // Wait for this model's graph: right after navigating, the previous model's graph is still loaded.
  const graphReady = Boolean(graph && graph.modelId === modelId);
  useEffect(() => {
    if (!graphReady || (!wantedSuggestion && !wantsSuggestions)) return;
    if (wantedSuggestion && !sourceSuggestions.data && !sourceSuggestions.isError) return;
    const option = Number(searchParams.get('option') ?? 0);
    const browse = searchParams.get('browse') === '1';
    const chosen = searchParams.get('choice') === '1' && modelId && wantedSuggestion ? takeChosenSource(modelId, wantedSuggestion) : undefined;
    setSearchParams((params) => {
      for (const key of ['suggestion', 'option', 'browse', 'sources', 'choice']) params.delete(key);
      return params;
    }, { replace: true });
    if (!wantedSuggestion) { openSuggestions(); return; }
    const suggestion = sourceSuggestions.data?.suggestions.find((item) => item.conceptKey === wantedSuggestion);
    if (!suggestion) { showError(t('assistantSources.openFailed')); return; }
    if (chosen) openSourceOption(suggestion, chosen);
    // A choice made in a conversation is gone after a reload: choose again here.
    else if (browse || searchParams.get('choice') === '1') browseForSuggestion(suggestion);
    else useSuggestion(suggestion, option);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphReady, wantedSuggestion, wantsSuggestions, sourceSuggestions.data, sourceSuggestions.isError]);

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
  const reviewCount = (modelHealth.data?.summary.fixesNeeded ?? 0) + (modelHealth.data?.summary.setupItems ?? 0);
  const published = Boolean(model.data?.currentPublishedVersionId);
  const repairMapping = (mappingId: string, bulkEdit?: boolean) => {
    const mapping = sourceMappings.data?.find((candidate) => candidate.id === mappingId);
    if (!mapping) { setMode('mappings'); return; }
    void openMappingTarget({ ...mappingTarget_(mapping), ...(bulkEdit ? { bulkEdit } : {}) });
  };
  // The editors open over the canvas, not over the health screen.
  const leaveHealth = () => { if (mode === 'health') setMode('structure'); };
  // A check issue opens where it is fixed: the source link or derived source it names, else the relationship, else the concept.
  const openCheckIssue = (issue: ModelCheckIssue) => {
    const target = checkTarget(issue);
    leaveHealth();
    if (target.kind === 'mapping' && sourceMappings.data?.some((mapping) => mapping.id === target.id)) { repairMapping(target.id); return; }
    const derived = target.kind === 'source' ? derivedSources.data?.find((source) => source.id === target.id) : undefined;
    if (derived) { openDerived({ conceptId: derived.conceptId, derived }); return; }
    const relationId = issue.relationId && graph.relations.some((relation) => relation.id === issue.relationId) ? issue.relationId : undefined;
    const conceptId = issue.conceptId && graph.nodes.some((node) => node.id === issue.conceptId) ? issue.conceptId : undefined;
    if (!relationId && !conceptId) return;
    setMode('structure');
    if (relationId) focus(relationId, 'matching');
    else if (conceptId) focus(conceptId, ['no_identity', 'missing_label_field', 'unmapped_identity'].includes(issue.code) ? 'identity' : undefined);
  };
  const openGraphViewer = () => {
    setGraphViewerOpen(true);
  };
  const openVersions = () => { setKnowledgeOpen(false); closeRunPanel(); setSuggestionsOpen(false); setMappingTarget(null); setVersionsOpen(true); };
  const startSwitch = (source: DesignerSource) => {
    if (!source.mappings.length) return;
    setVersionsOpen(false); closeRunPanel(); setSuggestionsOpen(false); setMappingTarget(null);
    setSwitching({ label: source.label, mappings: source.mappings });
    openKnowledge(source.mappings[0].conceptId);
  };
  const switchTo = (picked: SourceMappingTarget) => {
    if (!switching) return;
    const [first, ...rest] = switching.mappings;
    const base = { ...picked, conceptId: undefined };
    switchQueue.current = { base, rest, switched: [] };
    setSwitching(null);
    closeKnowledge();
    void openMappingTarget({ ...base, conceptId: first.conceptId, replaces: first });
  };
  /** Read one concept's sources again from its records table; the rest of the data in use is kept. */
  const refreshConcept = async (conceptId: string, rereadDocuments: boolean) => {
    if (!modelId) return;
    try {
      const run = await semanticModelApi.requestPopulationRefresh(modelId, {
        purpose: 'build', scope: { kind: 'concept', conceptId }, ...(rereadDocuments ? { rereadDocuments } : {}),
      });
      setRunConceptIds(conceptsRefreshedWith(conceptId, derivedSources.data ?? []));
      setPopulationJobId(run.jobId);
      setPopulation({ jobId: run.jobId, status: run.status, skipped: run.skipped, reused: run.reused, sourceCount: run.sourceCount });
    } catch (error) {
      // The code's text says the run is refused; the details say which source and why.
      showError(t('records.table.refreshError'), { description: [parseApiError(error).message, ...apiErrorDetails(error)].join(' ') });
    }
  };
  const readSwitched = async (mappingIds: string[]) => {
    if (!modelId) return;
    try {
      const run = await semanticModelApi.requestPopulationRefresh(modelId, {
        purpose: 'refresh', scope: mappingIds.length === 1 ? { kind: 'mapping', mappingId: mappingIds[0] } : { kind: 'model' },
      });
      const mappedConcept = mappingIds.length === 1 ? sourceMappings.data?.find((mapping) => mapping.id === mappingIds[0])?.conceptId : undefined;
      setRunConceptIds(mappedConcept ? [mappedConcept] : null);
      setPopulationJobId(run.jobId);
    } catch (error) {
      showError(t('mapping.switch.readError'), { description: [parseApiError(error).message, ...apiErrorDetails(error)].join(' ') });
    }
  };
  const mappingSaved = () => {
    const queue = switchQueue.current;
    const replaced = mappingTarget?.replaces;
    if (!queue || !replaced) return;
    queue.switched.push(replaced.id);
    const [next, ...rest] = queue.rest;
    if (next) {
      nextSwitch.current = { ...queue.base, conceptId: next.conceptId, replaces: next };
      queue.rest = rest;
      return;
    }
    switchQueue.current = null;
    const switched = queue.switched;
    showSuccess(t('mapping.switch.done', { name: queue.base.documentName, count: switched.length }), {
      duration: 12000, action: { label: t('mapping.switch.readNow'), onClick: () => void readSwitched(switched) },
    });
  };
  const mappingClosed = () => {
    const next = nextSwitch.current;
    nextSwitch.current = null;
    // Closed without saving: the mappings not switched yet stay on their source.
    if (!next) switchQueue.current = null;
    setMappingTarget(next);
  };
  const closeSidePanels = () => { setVersionsOpen(false); closeRunPanel(); setSuggestionsOpen(false); setRunHistoryOpen(false); };
  const openReview = () => { setKnowledgeOpen(false); closeRunPanel(); setVersionsOpen(false); setSuggestionsOpen(false); setMappingTarget(null); setRunHistoryOpen(false); setMode('health'); };
  const openRunHistory = () => { setKnowledgeOpen(false); closeRunPanel(); setVersionsOpen(false); setSuggestionsOpen(false); setMappingTarget(null); setRunHistoryOpen(true); };
  // A review list that names the field only by its label ("customer id") still leads to the right field.
  const fieldKey = (conceptId: string, label: unknown) => {
    const wanted = String(label ?? '').trim().toLocaleLowerCase().replaceAll(/[\s_-]+/g, ' ');
    if (!wanted) return undefined;
    const attribute = graph.nodes.find((node) => node.id === conceptId)?.attributes
      .find((candidate) => [candidate.label, candidate.key].some((name) => name.toLocaleLowerCase().replaceAll(/[\s_-]+/g, ' ') === wanted));
    return attribute?.key ?? wanted.replaceAll(' ', '_');
  };
  // Each item opens where it is fixed, and the bar above the work area keeps saying what and where.
  const openIssue = (item: ReviewQueueItem) => {
    setReviewFocus(item);
    leaveHealth();
    const action = item.action;
    switch (action.kind) {
      case 'repair_mapping': repairMapping(action.mappingId, action.bulkEdit); break;
      case 'repair_derived': openDerived({ conceptId: action.conceptId, derived: derivedSources.data?.find((source) => source.id === action.derivedSourceId) }); break;
      case 'choose_unique_field': setMode('structure'); focus(action.conceptId, 'identity'); break;
      case 'set_up_link': setMode('structure'); focus(action.relationId, 'matching'); break;
      // Links that found nothing are looked at in the records: which ones, and the value they looked for.
      case 'check_links': setMode('records'); setDataFocus({ relationId: action.relationId, at: Date.now() }); break;
      case 'review_rows': setMode('records'); setDataFocus({ conceptId: action.conceptId, rows: true, at: Date.now() }); break;
      case 'add_source':
      case 'open_sources': setMode('structure'); focus(action.conceptId, 'sources'); break;
      case 'fix_values': setMode('records'); setDataFocus({ conceptId: action.conceptId, attribute: action.attribute ?? fieldKey(action.conceptId, item.params.field), at: Date.now() }); break;
      case 'view_data': setMode('records'); setDataFocus(null); break;
      case 'open_run_history': openRunHistory(); break;
      case 'choose_label_field': setMode('structure'); focus(action.conceptId, 'identity'); break;
      default: break;
    }
  };
  // A health card opens where its fix is made, or the records it is about. Nothing is changed from here.
  const openHealthAction = (action: HealthAction) => {
    switch (action.kind) {
      case 'choose_unique_field':
        setMode('structure');
        if (action.suggestedFields?.length) suggestIdentity(action.conceptId, action.suggestedFields); else focus(action.conceptId, 'identity');
        break;
      case 'open_sources': setMode('structure'); focus(action.conceptId, 'sources'); break;
      case 'fix_values': setMode('records'); setDataFocus({ conceptId: action.conceptId, attribute: action.attribute, at: Date.now() }); break;
      case 'check_links': setMode('records'); setDataFocus({ relationId: action.relationId, at: Date.now() }); break;
      case 'view_records': setMode('records'); setDataFocus({ conceptId: action.conceptId, at: Date.now() }); break;
      // The limits are the admins' to change, in the settings for every model.
      case 'raise_ai_limit':
      case 'open_run_limits': navigate('/admin/semantic-model-settings'); break;
      default: break;
    }
  };
  const openManualTable = (conceptId: string) => {
    closeSidePanels(); setKnowledgeOpen(false); setMappingTarget(null); setDerivedTarget(null);
    setManualConceptId(conceptId);
  };
  const openSource = (source: DesignerSource, mapping?: ConceptSourceMapping) => {
    if (source.kind === 'typed') { openManualTable(source.id.slice('typed:'.length)); return; }
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
    { key: 'typed', icon: Table2, label: t('designer.palette.typed'), hint: t('designer.palette.typedHint'), onClick: () => {
      // A selected concept that can hold rows is the table to open; otherwise ask which concept.
      const selectedConcept = graph.nodes.find((node) => node.id === selectedId && !node.systemKey && node.recordPolicy !== 'none');
      if (selectedConcept) openManualTable(selectedConcept.id); else setManualPickOpen(true);
    } },
    { key: 'concept', icon: Box, label: t('designer.palette.concept'), hint: t('designer.palette.conceptHint'), onClick: () => setConceptOpen(true) },
    { key: 'relation', icon: Spline, label: t('designer.palette.relation'), hint: t('designer.palette.relationHint'), onClick: () => setRelationOpen(true) },
    { key: 'suggest', icon: Sparkles, label: t('designer.palette.suggest'), hint: t('designer.palette.suggestHint'), onClick: () => setSuggestSource('pick') },
  ];
  const onCanvas = mode === 'structure';
  const moveSource = (id: string, position: { x: number; y: number }) => {
    if (!modelId) return;
    const key = semanticModelQueryKeys.canvasPositions(modelId);
    // Show the move at once; the server only records where the box sits.
    queryClient.setQueryData<Array<{ id: string; x: number; y: number }>>(key, (current = []) => [...current.filter((item) => item.id !== id), { id, ...position }]);
    semanticModelApi.saveCanvasPositions(modelId, [{ id, ...position }]).catch((error) => {
      showError(t('save.error'), { description: parseApiError(error).message });
      void queryClient.invalidateQueries({ queryKey: key });
    });
  };
  const toggleKey = (conceptId: string, field: string) => {
    if (!modelId) return;
    const fields = identityRules.data?.find((rule) => rule.conceptId === conceptId)?.fields ?? [];
    const next = fields.includes(field) ? fields.filter((item) => item !== field) : [...fields, field];
    semanticModelApi.saveIdentityRule(modelId, conceptId, next).then(() => Promise.all([
      queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.identityRules(modelId) }),
      queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceMappings(modelId) }),
      queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
      queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.freshness(modelId) }),
    ]).then(() => refreshModelCheck())).catch((error) => showError(t('canvasTools.keyError'), { description: parseApiError(error).message }));
  };
  const freshnessState = freshness.data?.state;
  // Preview, Run and Publish wait for errors to be fixed; warnings never hold them back.
  const checkBlock = checkBlockReason(checkResult, t as (key: string | string[], options?: Record<string, unknown>) => string);
  const unpublishedChanges = publishComparison.data?.changes.length ?? 0;
  const hasUnpublished = Boolean(draftVersionId) && (!publishedVersionId || unpublishedChanges > 0);
  return (
    <div className="flex h-[100dvh] w-full min-w-0 max-w-full flex-col overflow-hidden bg-muted/15">
      {/* One line at every width: labels give way to icons before anything wraps. */}
      <header className="flex shrink-0 items-center gap-2 border-b bg-background px-4 py-2">
        <Button size="icon" variant="ghost" asChild aria-label={t("editor.back")}>
          <Link to="/semantic-models"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="me-1 min-w-0">
          <h1 className="max-w-48 truncate text-sm font-semibold sm:max-w-80">{model.data?.name}</h1>
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            {t(model.data?.kind === "workspace_default" ? "editor.automaticModel" : "editor.designedModel")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px]" title={statusLabel}>
          <Save className={`h-3.5 w-3.5 ${saveStatus === "saving" ? "animate-pulse text-primary" : saveStatus === "conflict" || saveStatus === "error" ? "text-destructive" : "text-muted-foreground"}`} />
          <span className="hidden md:inline">{statusLabel}</span>
          {(saveStatus === "error" || saveStatus === "offline") && (
            <button type="button" className="ms-1 font-semibold text-primary underline-offset-2 hover:underline" onClick={retrySave}>{t("action.retry")}</button>
          )}
        </div>
        {canEdit && onCanvas && <div className='hidden items-center sm:flex'>
          <Button size='icon' variant='ghost' disabled={!undoStack.length || historyBusy} onClick={() => void undo()} aria-label={t('action.undo')} title={`${t('action.undo')} (Ctrl+Z)`}><Undo2 className='h-4 w-4' /></Button>
          <Button size='icon' variant='ghost' disabled={!redoStack.length || historyBusy} onClick={() => void redo()} aria-label={t('action.redo')} title={`${t('action.redo')} (Ctrl+Shift+Z)`}><Redo2 className='h-4 w-4' /></Button>
          <Button size='icon' variant='ghost' onClick={autoLayout} aria-label={t('action.autoLayout')}><LayoutDashboard className='h-4 w-4' /></Button>
        </div>}
        <div className="flex-1" />
        {/* One line that says where the model stands, instead of steps and percentages. */}
        <p className="hidden whitespace-nowrap text-xs text-muted-foreground xl:block" aria-live="polite">
          {t(published ? 'designer.status.published' : 'designer.status.draft')}
          {recordCount !== undefined && <> · {t('editor.recordCount', { count: recordCount })}</>}
          {freshnessState && freshnessState !== 'not_runnable' && <> · <span title={t(freshnessState === 'current' ? 'freshness.currentHint' : freshnessState === 'outdated' ? 'freshness.outdatedHint' : 'freshness.neverHint')}
            className={freshnessState === 'outdated' ? 'font-medium text-amber-700 dark:text-amber-400' : freshnessState === 'current' ? 'text-emerald-700 dark:text-emerald-400' : undefined}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full align-middle ${freshnessState === 'current' ? 'bg-emerald-500' : freshnessState === 'outdated' ? 'bg-amber-500' : 'bg-muted-foreground/50'}`} aria-hidden />
            <span className='ms-1 hidden 2xl:inline'>{t(`freshness.${freshnessState}`)}</span><span className='sr-only 2xl:hidden'>{t(`freshness.${freshnessState}`)}</span></span></>}
        </p>
        {modelId && <GraphStatusTooltip modelId={modelId} />}
        <div className="flex shrink-0 items-center gap-1.5">
          {!onCanvas && <Button size='sm' variant='outline' onClick={() => setMode('structure')}><Workflow className='me-1.5 h-4 w-4' />{t('designer.backToCanvas')}</Button>}
          {onCanvas && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size='sm' variant='ghost' aria-label={t('designer.data')} title={t('designer.data')}><Table2 className='h-4 w-4 xl:me-1.5' /><span className='hidden xl:inline'>{t('designer.data')}</span><ChevronDown className='ms-1 h-3.5 w-3.5' /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align='end' onCloseAutoFocus={(event) => event.preventDefault()}>
              <DropdownMenuItem onSelect={() => setMode('records')}><Table2 className='h-4 w-4' />{t('mode.records')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={openGraphViewer}><Network className='h-4 w-4' />{t('dataWorkflow.dataGraph')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMode('mappings')}><ListChecks className='h-4 w-4' />{t('designer.sourceList')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          {suggestionList.length > 0 && <Button variant='ghost' size='sm' onClick={() => (suggestionsOpen ? setSuggestionsOpen(false) : openSuggestions())}>
            {t('assistantSources.toolbar')}
            {pendingSuggestions > 0 && <span className='ms-2 rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary' aria-label={t('assistantSources.pending', { count: pendingSuggestions })}>{pendingSuggestions}</span>}
          </Button>}
          <Button variant='ghost' size='sm' className={mode === 'health' ? 'bg-muted' : undefined} aria-pressed={mode === 'health'} title={t('health.button')} onClick={() => (mode === 'health' ? setMode('structure') : openReview())}>
            <HeartPulse className='h-4 w-4 lg:hidden' /><span className='hidden lg:inline'>{t('health.button')}</span>
            {reviewCount > 0 && <span className='ms-2 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300' aria-label={t('health.badge', { count: reviewCount })}>{reviewCount}</span>}
          </Button>
          <Button variant='ghost' size='sm' className={versionsOpen ? 'bg-muted' : undefined} aria-pressed={versionsOpen} onClick={() => (versionsOpen ? setVersionsOpen(false) : openVersions())} aria-label={t('designer.versions')} title={t('designer.versions')}><History className='h-4 w-4' /></Button>
          <Button variant='ghost' size='sm' className={runHistoryOpen ? 'bg-muted' : undefined} aria-pressed={runHistoryOpen} onClick={() => (runHistoryOpen ? setRunHistoryOpen(false) : openRunHistory())} aria-label={t('runHistory.title')} title={t('runHistory.title')}><ListOrdered className='h-4 w-4' /></Button>
          <MyJobsButton modelId={modelId} />
          {model.data && <Button variant='ghost' size='sm' className='text-muted-foreground hover:text-primary' onClick={() => setCloneModelOpen(true)} aria-label={t('clone.button')} title={t('clone.button')}><Copy className='h-4 w-4' /></Button>}
          {model.data?.role === 'owner' && <Button variant='ghost' size='sm' className='text-muted-foreground hover:text-destructive' onClick={() => setDeleteModelOpen(true)} aria-label={t('deleteModel.button')} title={t('deleteModel.button')}><Trash2 className='h-4 w-4' /></Button>}
          {/* Always the way back to the run's side panel: while an update or the search index build runs, and after the last update ended. */}
          {canEdit && statusTarget && <Button variant='outline' size='sm' aria-pressed={runPanelOpen}
            className={cn(runPanelOpen && 'bg-muted', busy && 'border-primary/50 text-primary')}
            aria-label={t(runPanelOpen ? 'runStatus.hide' : statusTarget === 'run' ? 'runStatus.showRun' : statusTarget === 'index' ? 'runStatus.showIndex' : 'runStatus.showLast')}
            title={t(runPanelOpen ? 'runStatus.hide' : statusTarget === 'run' ? 'runStatus.showRun' : statusTarget === 'index' ? 'runStatus.showIndex' : 'runStatus.showLast')}
            onClick={() => (runPanelOpen ? closeRunPanel() : openRunStatus())}>
            {busy ? <Loader2 className='h-4 w-4 animate-spin lg:me-1.5' /> : <PanelRightOpen className='h-4 w-4 lg:me-1.5' />}
            <span className='hidden lg:inline'>{t(statusTarget === 'run' ? 'runStatus.run' : statusTarget === 'index' ? 'runStatus.index' : 'runStatus.last')}</span>
          </Button>}
          {/* While the model is busy (a data update in any phase, or its search index being built) the button is Stop, not Run. */}
          {canEdit && (populationJobId || indexBuilding) && <div className='flex items-center gap-1'>
            <TooltipProvider><Tooltip>
              <TooltipTrigger asChild><span tabIndex={populationJobId && !runStoppable ? 0 : undefined}>
                <Button variant='outline' size='sm' aria-label={t('runStop.stop')}
                  disabled={populationJobId ? runStopRequested || !runStoppable : stoppingIndex}
                  onClick={() => setConfirmStop(populationJobId ? 'run' : 'index')}>
                  {(populationJobId ? runStopRequested : stoppingIndex) ? <Loader2 className='me-1.5 h-4 w-4 animate-spin' /> : <StopCircle className='me-1.5 h-4 w-4' />}
                  {(populationJobId ? runStopRequested : stoppingIndex) ? t('runStop.stopping') : t('runStop.stop')}
                </Button>
              </span></TooltipTrigger>
              <TooltipContent>{stopPending && stopSlow ? t('runStatus.stoppingSlowHint')
                : populationJobId ? (runStoppable ? t('runStop.running') : t('runStop.notNow')) : t('runStop.indexBuilding')}</TooltipContent>
            </Tooltip></TooltipProvider>
            {indexStalled && <TooltipProvider><Tooltip>
              <TooltipTrigger asChild><span>
                <Button variant='outline' size='sm' aria-label={t('runStop.restart')} disabled={restartingIndex} onClick={() => void restartIndex()}>
                  {restartingIndex ? <Loader2 className='me-1.5 h-4 w-4 animate-spin' /> : <RotateCcw className='me-1.5 h-4 w-4' />}
                  {restartingIndex ? t('runStop.restarting') : t('runStop.restart')}
                </Button>
              </span></TooltipTrigger>
              <TooltipContent>{t('runStop.restartHint')}</TooltipContent>
            </Tooltip></TooltipProvider>}
          </div>}
          {canEdit && !populationJobId && !indexBuilding && <Button variant='outline' size='sm' disabled={!canValidate || Boolean(checkBlock)}
            onClick={() => setValidateOpen(true)}
            title={checkBlock ?? (freshnessState && freshnessState !== 'not_runnable' ? t(freshnessState === 'current' ? 'freshness.currentHint' : freshnessState === 'outdated' ? 'freshness.outdatedHint' : 'freshness.neverHint') : undefined)}
            // Run says what it would do: generate the first data, bring stale data up to date, or just run again.
            className={freshnessState === 'outdated' || freshnessState === 'never_run' ? 'border-amber-500/60 text-amber-800 hover:bg-amber-500/10 dark:text-amber-300' : undefined}>
            <Play className='me-1.5 h-4 w-4' />
            {/* The status line is hidden on narrower screens; the dot keeps telling whether the data is current. */}
            {freshnessState && freshnessState !== 'not_runnable' && <span aria-hidden className={`order-first me-1.5 h-1.5 w-1.5 rounded-full xl:hidden ${freshnessState === 'current' ? 'bg-emerald-500' : freshnessState === 'outdated' ? 'bg-amber-500' : 'bg-muted-foreground/50'}`} />}
            {freshnessState === 'outdated' ? t('freshness.runToUpdate') : freshnessState === 'never_run' ? t('freshness.generate') : t('designer.run')}
          </Button>}
          {canEdit && <Button size='sm' className='relative' onClick={() => (versionsOpen ? setVersionsOpen(false) : openVersions())}
            title={hasUnpublished ? (publishedVersionId ? t('publishState.changes', { count: unpublishedChanges }) : t('publishState.never')) : t('publishState.none')}>
            {t('workspaceUi.publishShort')}
            {hasUnpublished && <span className='absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-amber-400' aria-label={publishedVersionId ? t('publishState.changes', { count: unpublishedChanges }) : t('publishState.never')} />}
          </Button>}
        </div>
      </header>
      <main className="relative flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          {reviewFocus && mode !== 'health' && <ReviewFocusBar item={reviewFocus} items={modelHealth.data?.setup ?? []} onOpen={openIssue} onBack={openReview} onClose={() => setReviewFocus(null)} />}
          {onCanvas && <div className='relative min-h-0 flex-1'>
            {canEdit && <CanvasPalette title={t('designer.palette.title')} help={t('designer.palette.help')} items={palette} />}
            <SemanticModelCanvas
            sourceMappings={sourceMappings.data}
            derivedSources={derivedSources.data}
            onOpenDerived={canEdit ? (derived) => openDerived({ conceptId: derived.conceptId, derived }) : undefined}
            identityRules={identityRules.data}
            recordCounts={conceptRecordCounts}
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
            onPaneClick={() => { closeSidePanels(); if (knowledgeOpen) closeKnowledge(); setMappingTarget(null); setDerivedTarget(null); setManualConceptId(null); }}
            onRemoveSource={(source, mapping) => void removeSource(source.label, mapping ? [mapping] : source.mappings)}
            onSwitchSource={canEdit ? startSwitch : undefined}
            onAddFeed={(source) => { const first = source.mappings[0]; if (first) void openMappingTarget({ ...mappingTarget_(first), mapping: undefined, conceptId: undefined }); }}
            onToggleKey={canEdit ? toggleKey : undefined}
            sourcePositions={sourcePositions}
            onMoveSource={canEdit ? moveSource : undefined}
            onBrowseRecords={browseRecords}
            onOpenManualTable={canEdit ? openManualTable : undefined}
            refreshingConcepts={populationJobId ? refreshingConcepts : undefined}
            checkIssues={checkResult?.issues}
            onOpenCheckIssue={openCheckIssue}
          />
          </div>}
          {onCanvas && modelId && recordsConceptId && graph.nodes.some((node) => node.id === recordsConceptId) && <ConceptRecordsPanel
            modelId={modelId}
            conceptId={recordsConceptId}
            onClose={() => setRecordsConceptId(null)}
            onOpenSource={(mapping) => void openMappingTarget(mappingTarget_(mapping))}
            onRefresh={canEdit ? () => setRefreshConceptId(recordsConceptId) : undefined}
            refreshing={Boolean(populationJobId)}
          />}
          {mode === 'records' && modelId && <SemanticDataPreview modelId={modelId} dataRevisionId={boundDataRevisionId} onDataRevision={setBoundDataRevisionId} onOpenReview={openReview} focus={dataFocus} canEdit={canEdit}
            onOpenMapping={repairMapping} onOpenIdentity={(id) => { setMode('structure'); focus(id, 'identity'); }} onOpenMatching={(id) => { setMode('structure'); focus(id, 'matching'); }} onRebuildStarted={setPopulationJobId} />}
          {mode === 'health' && modelId && <ModelHealthView modelId={modelId} canEdit={canEdit} onAction={openHealthAction}
            setup={<ModelSetupChecks modelId={modelId} canEdit={canEdit && pending.length === 0} items={modelHealth.data?.setup ?? []} activeKey={reviewFocus?.key}
              modelCheck={checkResult} modelCheckFailed={modelCheck.isError && !checkResult} checkMappings={sourceMappings.data} checkDerivedSources={derivedSources.data}
              onOpenCheckIssue={openCheckIssue} onOpenIssue={openIssue} validation={validation} onOpenValidationIssue={(id) => { setMode('structure'); focus(id); }}
              canRunCheck={canValidate} checking={checking} onRunCheck={() => void validate()} />} />}
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
                  <DropdownMenuContent align="center" onCloseAutoFocus={(event) => event.preventDefault()}>
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
          progress={populationJob.data?.jobId === population.jobId ? populationJob.data?.progress : undefined}
          conceptLabels={conceptLabels}
          onClose={() => closeRunPanel()}
          onOpenHealth={() => { closeRunPanel(); setMode('health'); }}
          onStop={canEdit ? () => setConfirmStop(['queued', 'waiting_dependencies'].includes(population.status) ? 'queued' : 'run') : undefined}
          jobsAction={<MyJobsButton modelId={modelId} queueLabel />}
          stopping={runStopRequested}
          stoppingSlow={stopSlow}
          serving={(populationJob.data?.jobId === population.jobId ? populationServing(populationJob.data?.result) : undefined) ?? population.serving}
          modelId={modelId}
          dataRevisionId={populationJob.data?.jobId === population.jobId && typeof populationJob.data?.result?.dataRevisionId === 'string' ? populationJob.data.result.dataRevisionId : undefined}
          queue={populationJob.data?.jobId === population.jobId && populationJob.data.state === 'queued' ? populationJob.data.queue : undefined}
          queuedSince={populationJob.data?.jobId === population.jobId ? populationJob.data.createdAt : undefined}
        />}
        {indexPanelOpen && !population && modelId && <SearchIndexPanel modelId={modelId} building={indexBuilding} onClose={() => setIndexPanelOpen(false)}
          onStop={canEdit ? () => setConfirmStop('index') : undefined} stopping={stoppingIndex} stoppingSlow={stopSlow} />}
        {runHistoryOpen && modelId && !runPanelOpen && <RunHistoryPanel modelId={modelId} onClose={() => setRunHistoryOpen(false)} onOpenReview={openReview}
          onOpenRun={(job) => { setRunHistoryOpen(false); setRunConceptIds(null); setPopulationJobId(job.jobId); setPopulation({ jobId: job.jobId, status: job.state, skipped: [], reused: false }); }} />}
        {modelId && <SourceChooserDialog open={Boolean(choosingFor)} modelId={modelId} conceptLabel={choosingFor?.conceptLabel ?? ''} onClose={() => setChoosingFor(null)}
          onChoose={(option) => { const suggestion = choosingFor; setChoosingFor(null); if (suggestion) openSourceOption(suggestion, option); }} />}
        {suggestionsOpen && modelId && !runPanelOpen && <aside className='relative z-20 flex h-full w-full max-w-sm shrink-0 flex-col border-l bg-background shadow-xl' aria-label={t('assistantSources.panelTitle')}>
          <header className='flex items-start gap-3 border-b px-4 py-3'>
            <div className='min-w-0 flex-1'>
              <h2 className='font-semibold'>{t('assistantSources.panelTitle')}</h2>
              <p className='mt-1 text-xs text-muted-foreground'>{t('assistantSources.hint')}</p>
            </div>
            <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0' onClick={() => setSuggestionsOpen(false)} aria-label={t('action.close')}><X className='h-4 w-4' /></Button>
          </header>
          <div className='min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-28'>
            {suggestionList.length
              ? <SourceSuggestionsList modelId={modelId} suggestions={suggestionList} canEdit={canEdit} onUse={useSuggestion} onBrowse={browseForSuggestion} />
              : <p className='text-sm text-muted-foreground'>{t('assistantSources.empty')}</p>}
          </div>
        </aside>}
        {versionsOpen && modelId && !runPanelOpen && !suggestionsOpen && <VersionsPanel
          modelId={modelId}
          canEdit={canEdit}
          canPublish={canEdit && saveStatus === "saved"}
          publishBlockedReason={checkBlock}
          onClose={() => setVersionsOpen(false)}
          onPublished={() => {
            hydratedVersionRef.current = null;
            void graphQuery.refetch();
            void model.refetch();
          }}
        />}
        {(knowledgeOpen || (onCanvas && detailsOpen)) && !runPanelOpen && !suggestionsOpen && !versionsOpen && <SemanticModelInspector modelId={modelId!} canEdit={canEdit} onBrowseRecords={browseRecords} recordCounts={conceptRecordCounts} knowledge={knowledge} knowledgeOpen={knowledgeOpen} knowledgeTargetId={knowledgeTargetId} onKnowledgeClose={() => { setSwitching(null); closeKnowledge(); }} switching={switching ? { label: switching.label, count: switching.mappings.length } : undefined} onMapData={(target) => { if (switching) switchTo(target); else void openMappingTarget(target); }} onDeriveData={openDerived} onAddSource={(conceptId) => { closeSidePanels(); openKnowledge(conceptId); }} />}
        <ManualTableEditor conceptId={manualConceptId} canEdit={canEdit} onClose={() => setManualConceptId(null)} />
        {modelId && <DerivedSourceDrawer modelId={modelId} target={derivedTarget} onClose={() => setDerivedTarget(null)} />}
        {modelId && <SourceMappingDrawer modelId={modelId} target={mappingTarget} onClose={mappingClosed} onSaved={mappingSaved} onSuggestConcepts={canEdit ? (source) => { setMappingTarget(null); setSuggestSource(source); } : undefined} />}
      </main>
      <AddConceptDialog open={conceptOpen} onOpenChange={setConceptOpen} />
      {modelId && canEdit && <SuggestConceptsDialog modelId={modelId} open={suggestSource !== null} onOpenChange={(open) => { if (!open) setSuggestSource(null); }} source={suggestSource === 'pick' ? null : suggestSource} />}
      <AddRelationDialog
        open={relationOpen}
        onOpenChange={setRelationOpen}
        initialConnection={relationConnection}
      />
      <ManualTableDialog open={manualPickOpen} onOpenChange={setManualPickOpen} onPick={openManualTable} />
      <ConceptRefreshDialog
        open={refreshConceptId !== null}
        onOpenChange={(open) => { if (!open) setRefreshConceptId(null); }}
        conceptLabel={refreshConceptId ? conceptLabels[refreshConceptId] ?? refreshConceptId : ''}
        onConfirm={({ rereadDocuments }) => refreshConcept(refreshConceptId!, rereadDocuments)}
      />
      {modelId && (
        <SemanticModelValidateDialog
          open={validateOpen}
          onOpenChange={setValidateOpen}
          modelId={modelId}
          onPopulationStarted={(outcome) => { setPopulation(outcome); setRunConceptIds(null); setPopulationJobId(outcome.jobId); if (outcome.cleared) setBoundDataRevisionId(undefined); }}
          // What stops the run is in Review, each item opening where it is fixed.
          onRefused={() => { void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.reviewQueue(modelId) }); void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.freshness(modelId) }); openReview(); }}
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
          canExport={model.data?.role === "owner" || model.data?.role === "editor"}
          onRebuildStarted={setPopulationJobId}
          initialRecordId={graphRecord}
          onInitialRecord={onGraphRecord}
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
      {model.data && <CloneSemanticModelDialog model={model.data} open={cloneModelOpen} onOpenChange={setCloneModelOpen} />}
      {model.data?.role === 'owner' && <DeleteSemanticModelDialog model={model.data} open={deleteModelOpen} onOpenChange={setDeleteModelOpen}
        onDeleted={() => navigate('/semantic-models', { replace: true })} />}
      {/* Stopping asks first: a stopped update keeps nothing it read; a stopped index build is built again on request. */}
      <AlertDialog open={confirmStop !== null} onOpenChange={(open) => { if (!open) setConfirmStop(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmStop === 'index' ? t('runStop.indexConfirmTitle') : confirmStop === 'queued' ? t('myJobs.queuedRemoveTitle') : t('runStop.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{confirmStop === 'index' ? t('runStop.indexConfirmDescription') : confirmStop === 'queued' ? t('myJobs.queuedRemoveHint') : t('runStop.confirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('runStop.keepGoing')}</AlertDialogCancel>
            <AlertDialogAction className='bg-destructive text-destructive-foreground hover:bg-destructive/90' onClick={confirmedStop}>
              {confirmStop === 'index' ? t('runStop.indexConfirmAction') : confirmStop === 'queued' ? t('myJobs.removeQueued') : t('runStop.confirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
