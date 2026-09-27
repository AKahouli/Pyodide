import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SuggestConceptsDialog, type SuggestionSource } from '../components/editor/SuggestConceptsDialog';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  X,
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
import { announceUndoable, isTextEntry } from '../utils/undo-notice';
import { semanticModelApi } from "../api";
import {
  AddConceptDialog,
  AddRecordDialog,
  AddRelationDialog,
} from "../components/editor/EditorDialogs";
import { SemanticModelCanvas } from "../components/editor/SemanticModelCanvas";
import { SemanticModelInspector } from "../components/editor/SemanticModelInspector";
import { ConceptRecordsPanel } from "../components/records/ConceptRecordsPanel";
import { SemanticModelGraphViewer } from "../components/editor/SemanticModelGraphViewer";
import { SemanticModelValidateDialog } from "../components/editor/SemanticModelValidateDialog";
import { SourceMappingDrawer, sourceMappingTargetFromResource, sourceMappingTargetFromWorkspace, type SourceMappingTarget } from "../components/mapping/SourceMappingDrawer";
import { SourceSuggestionsList, takeChosenSource, useSourceSuggestions } from '../components/assistant/SourceSuggestions';
import { SourceChooserDialog } from '../components/assistant/SourceChooser';
import type { SourceSuggestion, SourceSuggestionOption } from "../types";
import { SemanticMappingsView } from '../components/mapping/SemanticMappingsView';
import { SemanticDataPreview } from '../components/preview/SemanticDataPreview';
import { SemanticTrustPanel } from '../components/review/SemanticTrustPanel';
import { PopulationStartedPanel, type PopulationOutcome } from '../components/population/PopulationStartedPanel';
import { VersionsPanel } from "../components/versions/VersionsPanel";
import { useKnowledgeLinking, type KnowledgeResource } from "../hooks/use-knowledge-linking";
import { useAssistantSync } from "../hooks/use-assistant-sync";
import { useCanvasPositions, useIdentityRules, useMappingHealth, usePopulationFreshness, useSemanticVersions, useVersionComparison, useSemanticDataPreview, useSemanticGraph, useSemanticModel, useReviewQueue, useSourceMappings } from "../query/hooks";
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
  const identityRules = useIdentityRules(modelId);
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
  // The concept whose records are shown in the table under the canvas.
  const [recordsConceptId, setRecordsConceptId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const [graphViewerOpen, setGraphViewerOpen] = useState(false);
  const [boundDataRevisionId, setBoundDataRevisionId] = useState<string>();
  const [populationJobId, setPopulationJobId] = useState<string>();
  const [trustOpen, setTrustOpen] = useState(false);
  const [population, setPopulation] = useState<PopulationOutcome | null>(null);
  const [stoppingRun, setStoppingRun] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
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
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId ?? 'none') });
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.reviewQueue(modelId ?? 'none') });
    }
    void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.freshness(modelId ?? 'none') });
    // Hand the final state to the run panel before we stop following the job, or it spins forever.
    const finalState = populationJob.data.state;
    const finalProgress = populationJob.data.progress;
    setPopulation((current) => current && current.jobId === populationJobId
      ? { ...current, status: finalState, progress: finalProgress ?? current.progress } : current);
    setPopulationJobId(undefined);
  }, [populationJob.data]);
  const [mappingTarget, setMappingTarget] = useState<SourceMappingTarget | null>(null);
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
    ]);
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
  }, [adoptRevision, modelId, pushAction, queryClient, t]);
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
  // A save refused because the model changed meanwhile is replayed once on the new revision.
  const conflictRetryRef = useRef(0);
  const { activeRun } = useAssistantSync(modelId);
  // A data update started from a conversation (or another tab) shows here once, with Stop.
  const adoptedRunsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!activeRun || adoptedRunsRef.current.has(activeRun.jobId) || populationJobId === activeRun.jobId) return;
    adoptedRunsRef.current.add(activeRun.jobId);
    setPopulationJobId(activeRun.jobId);
    setTrustOpen(false);
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
    if (!selectedId) return;
    if (focusRequest?.id !== selectedId) setTrustOpen(false);
    setPopulation(null);
    // The knowledge list belongs to the concept it was opened for; picking something else closes it.
    if (knowledgeTargetId !== selectedId) { setKnowledgeOpen(false); setKnowledgeTargetId(null); }
    // An open records table follows the concept being looked at.
    if (recordsConceptId && graph?.nodes.some((node) => node.id === selectedId && !node.systemKey)) setRecordsConceptId(selectedId);
  // Every click counts, including one on what is already selected, so the panel never stays on an earlier choice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, selectedId, selectionTick]);

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
  const stopRun = async () => {
    if (!modelId || !population) return;
    setStoppingRun(true);
    try {
      const job = await semanticModelApi.stopPopulationJob(modelId, population.jobId);
      setPopulation((current) => current && current.jobId === job.jobId ? { ...current, status: job.state } : current);
      void populationJob.refetch();
    } catch (error) {
      showError(t('runStop.error'), { description: parseApiError(error).message });
    } finally {
      setStoppingRun(false);
    }
  };
  const openSuggestions = () => { setKnowledgeOpen(false); setTrustOpen(false); setPopulation(null); setVersionsOpen(false); setSuggestionsOpen(true); };
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
  const closeSidePanels = () => { setTrustOpen(false); setVersionsOpen(false); setPopulation(null); setSuggestionsOpen(false); };
  const openSource = (source: DesignerSource, mapping?: ConceptSourceMapping) => {
    if (source.kind === 'typed') {
      // One typed record opens for editing; several open the records list.
      const typed = graph.records.filter((record) => source.id === `typed:${record.nodeTypeId}`);
      if (typed.length === 1) select(typed[0].id, { details: true }); else setMode('records');
      return;
    }
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
    ])).catch((error) => showError(t('canvasTools.keyError'), { description: parseApiError(error).message }));
  };
  const freshnessState = freshness.data?.state;
  const unpublishedChanges = publishComparison.data?.changes.length ?? 0;
  const hasUnpublished = Boolean(draftVersionId) && (!publishedVersionId || unpublishedChanges > 0);
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
          <Button size='icon' variant='ghost' disabled={!undoStack.length || historyBusy} onClick={() => void undo()} aria-label={t('action.undo')} title={`${t('action.undo')} (Ctrl+Z)`}><Undo2 className='h-4 w-4' /></Button>
          <Button size='icon' variant='ghost' disabled={!redoStack.length || historyBusy} onClick={() => void redo()} aria-label={t('action.redo')} title={`${t('action.redo')} (Ctrl+Shift+Z)`}><Redo2 className='h-4 w-4' /></Button>
          <Button size='icon' variant='ghost' onClick={autoLayout} aria-label={t('action.autoLayout')}><LayoutDashboard className='h-4 w-4' /></Button>
        </div>}
        <div className="flex-1" />
        {/* One line that says where the model stands, instead of steps and percentages. */}
        <p className="hidden whitespace-nowrap text-xs text-muted-foreground lg:block" aria-live="polite">
          {t(published ? 'designer.status.published' : 'designer.status.draft')}
          {recordCount !== undefined && <> · {t('editor.recordCount', { count: recordCount })}</>}
          {freshnessState && freshnessState !== 'not_runnable' && <> · <span title={t(freshnessState === 'current' ? 'freshness.currentHint' : freshnessState === 'outdated' ? 'freshness.outdatedHint' : 'freshness.neverHint')}
            className={freshnessState === 'outdated' ? 'font-medium text-amber-700 dark:text-amber-400' : freshnessState === 'current' ? 'text-emerald-700 dark:text-emerald-400' : undefined}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full align-middle ${freshnessState === 'current' ? 'bg-emerald-500' : freshnessState === 'outdated' ? 'bg-amber-500' : 'bg-muted-foreground/50'}`} aria-hidden />
            <span className='ml-1 hidden 2xl:inline'>{t(`freshness.${freshnessState}`)}</span><span className='sr-only 2xl:hidden'>{t(`freshness.${freshnessState}`)}</span></span></>}
          {reviewCount > 0 && <> · <span className="text-amber-700 dark:text-amber-400">{t(reviewCount === 1 ? 'designer.status.issues_one' : 'designer.status.issues_other', { count: reviewCount })}</span></>}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {!onCanvas && <Button size='sm' variant='outline' onClick={() => setMode('structure')}><Workflow className='mr-1.5 h-4 w-4' />{t('designer.backToCanvas')}</Button>}
          {onCanvas && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size='sm' variant='ghost'><Table2 className='mr-1.5 h-4 w-4' />{t('designer.data')}<ChevronDown className='ml-1 h-3.5 w-3.5' /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align='end' onCloseAutoFocus={(event) => event.preventDefault()}>
              <DropdownMenuItem onSelect={() => setMode('records')}><Table2 className='h-4 w-4' />{t('mode.records')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={openGraphViewer}><Network className='h-4 w-4' />{t('dataWorkflow.dataGraph')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMode('mappings')}><ListChecks className='h-4 w-4' />{t('designer.sourceList')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          {suggestionList.length > 0 && <Button variant='ghost' size='sm' onClick={() => (suggestionsOpen ? setSuggestionsOpen(false) : openSuggestions())}>
            {t('assistantSources.toolbar')}
            {pendingSuggestions > 0 && <span className='ml-2 rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary' aria-label={t('assistantSources.pending', { count: pendingSuggestions })}>{pendingSuggestions}</span>}
          </Button>}
          <Button variant='ghost' size='sm' onClick={() => { setKnowledgeOpen(false); setPopulation(null); setVersionsOpen(false); setSuggestionsOpen(false); setTrustOpen((open) => !open); }}>
            {t('reviewQueue.button')}
            {reviewCount > 0 && <span className='ml-2 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300' aria-label={t('reviewQueue.badge', { count: reviewCount })}>{reviewCount}</span>}
          </Button>
          <Button variant='ghost' size='sm' onClick={() => { setKnowledgeOpen(false); setTrustOpen(false); setVersionsOpen((open) => !open); }} aria-label={t('designer.versions')}><History className='h-4 w-4' /></Button>
          {canEdit && <Button variant='outline' size='sm' disabled={!populationJobId && !canValidate}
            // While a run goes on, the button shows it (with Stop) instead of starting another one.
            onClick={() => populationJobId
              ? (setTrustOpen(false), setSuggestionsOpen(false), setPopulation((current) => current ?? { jobId: populationJobId, status: populationJob.data?.state ?? 'running', skipped: [], reused: false }))
              : setValidateOpen(true)}
            title={freshnessState && freshnessState !== 'not_runnable' ? t(freshnessState === 'current' ? 'freshness.currentHint' : freshnessState === 'outdated' ? 'freshness.outdatedHint' : 'freshness.neverHint') : undefined}
            // Run says what it would do: generate the first data, bring stale data up to date, or just run again.
            className={!populationJobId && (freshnessState === 'outdated' || freshnessState === 'never_run') ? 'border-amber-500/60 text-amber-800 hover:bg-amber-500/10 dark:text-amber-300' : undefined}>
            {populationJobId ? <Loader2 className='mr-1.5 h-4 w-4 animate-spin' /> : <Play className='mr-1.5 h-4 w-4' />}
            {populationJobId ? t('designer.running') : freshnessState === 'outdated' ? t('freshness.runToUpdate') : freshnessState === 'never_run' ? t('freshness.generate') : t('designer.run')}
          </Button>}
          {canEdit && <Button size='sm' className='relative' onClick={() => { setKnowledgeOpen(false); setTrustOpen(false); setVersionsOpen(true); }}
            title={hasUnpublished ? (publishedVersionId ? t('publishState.changes', { count: unpublishedChanges }) : t('publishState.never')) : t('publishState.none')}>
            {t('workspaceUi.publishShort')}
            {hasUnpublished && <span className='absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-amber-400' aria-label={publishedVersionId ? t('publishState.changes', { count: unpublishedChanges }) : t('publishState.never')} />}
          </Button>}
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
            onRemoveSource={(source, mapping) => void removeSource(source.label, mapping ? [mapping] : source.mappings)}
            onAddFeed={(source) => { const first = source.mappings[0]; if (first) void openMappingTarget({ ...mappingTarget_(first), mapping: undefined, conceptId: undefined }); }}
            onToggleKey={canEdit ? toggleKey : undefined}
            sourcePositions={sourcePositions}
            onMoveSource={canEdit ? moveSource : undefined}
            onBrowseRecords={browseRecords}
          /></div>}
          {onCanvas && modelId && recordsConceptId && graph.nodes.some((node) => node.id === recordsConceptId) && <ConceptRecordsPanel
            modelId={modelId}
            conceptId={recordsConceptId}
            onClose={() => setRecordsConceptId(null)}
            onOpenSource={(mapping) => void openMappingTarget(mappingTarget_(mapping))}
          />}
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
          onClose={() => setPopulation(null)}
          onOpenHealth={() => { setPopulation(null); setTrustOpen(true); }}
          onStop={canEdit ? () => void stopRun() : undefined}
          stopping={stoppingRun}
        />}
        {modelId && <SourceChooserDialog open={Boolean(choosingFor)} modelId={modelId} conceptLabel={choosingFor?.conceptLabel ?? ''} onClose={() => setChoosingFor(null)}
          onChoose={(option) => { const suggestion = choosingFor; setChoosingFor(null); if (suggestion) openSourceOption(suggestion, option); }} />}
        {suggestionsOpen && modelId && !population && !trustOpen && <aside className='flex h-full w-full max-w-sm shrink-0 flex-col border-l bg-background' aria-label={t('assistantSources.panelTitle')}>
          <header className='flex items-start gap-3 border-b px-4 py-3'>
            <div className='min-w-0 flex-1'>
              <h2 className='font-semibold'>{t('assistantSources.panelTitle')}</h2>
              <p className='mt-1 text-xs text-muted-foreground'>{t('assistantSources.hint')}</p>
            </div>
            <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0' onClick={() => setSuggestionsOpen(false)} aria-label={t('action.close')}><X className='h-4 w-4' /></Button>
          </header>
          <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
            {suggestionList.length
              ? <SourceSuggestionsList modelId={modelId} suggestions={suggestionList} canEdit={canEdit} onUse={useSuggestion} onBrowse={browseForSuggestion} />
              : <p className='text-sm text-muted-foreground'>{t('assistantSources.empty')}</p>}
          </div>
        </aside>}
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
        {(knowledgeOpen || (onCanvas && detailsOpen)) && !trustOpen && !population && !suggestionsOpen && <SemanticModelInspector modelId={modelId!} canEdit={canEdit} onBrowseRecords={browseRecords} recordCounts={conceptRecordCounts} knowledge={knowledge} knowledgeOpen={knowledgeOpen} knowledgeTargetId={knowledgeTargetId} onKnowledgeClose={closeKnowledge} onMapData={(target) => void openMappingTarget(target)} />}
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
