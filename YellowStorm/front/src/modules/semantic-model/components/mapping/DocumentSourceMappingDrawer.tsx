import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, FileText, FolderOpen, ListChecks, Loader2, PanelLeftClose, PanelLeftOpen, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useOptionalSidebar } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import type { DocumentPreviewNavigation } from '@/modules/file-viewer/components/DocumentPreviewViewer';
import { useFileViewerStore } from '@/modules/file-viewer/store';
import { useModuleTranslation } from '@/modules/localization';
import { getDocument, getDocuments, getFolderContents } from '@/modules/workspace/api';
import { isMappableDocument, isStructuredDocument } from '../knowledge/KnowledgePanel';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSourceMappings } from '../../query/hooks';
import { useSemanticModelEditorStore } from '../../store';
import type { AiExtractionSettings, MappingSettings, DocumentFieldReading, DocumentLabelSuggestion, SourceExtractionStrategy, SourceFieldMapping, SourceMappingPreviewResponse, StructuredSourceAsset } from '../../types';
import { AiLimitsEditor, FieldReadingResult, ManyRecordsSwitch, FieldRulesEditor, limitProblem, newDocumentField, ReadAllFieldsBar, rulesProblem, STRATEGIES, usesAi as mappingsUseAi, usesRules, withConceptFields, type LabelSuggestions } from './DocumentFieldRules';
import { DEFAULT_SPLIT, DocumentPreviewPane, documentStatusText, FieldLiveStatus, highlightOf, useNarrow, useSplitPrefs } from './DocumentPreviewPane';
import { useLiveDocumentPreview } from './useLiveDocumentPreview';
import type { SourceMappingTarget, WorkspaceSourceScope } from './SourceMappingDrawer';
import { AiFieldSettings, withoutAiSettings } from './AiFieldSettings';
import { computedPayload, computedProblem, FieldRecipeEditor, newComputedRule } from './FieldRecipeEditor';
import { isReadableDocument, WorkspaceFilePicker, type WorkspacePick } from './WorkspaceFilePicker';
import { MappingPresetBar } from './MappingPresetBar';
import { FORM_SECTION, FormField, INPUT, INPUT_COMPACT, ROW_LIST, SectionHeader } from '../form/FormParts';

type PreviewItem = { asset: StructuredSourceAsset; result: SourceMappingPreviewResponse };

// Documents offered in the viewer's switcher, and how many are read for label suggestions.
const VIEWER_DOCUMENTS = 15;
/** How many folders are opened looking for sample files. */
const MAX_SAMPLE_FOLDERS = 12;
const LABEL_DOCUMENTS = 10;

export function DocumentSourceMappingDrawer({ modelId, target, onClose }: Readonly<{ modelId: string; target: SourceMappingTarget | null; onClose: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const [conceptId, setConceptId] = useState('');
  const [mappings, setMappings] = useState<SourceFieldMapping[]>([]);
  // Concept fields added after this mapping was saved: shown until it is saved, then read by the next run.
  const [addedFields, setAddedFields] = useState<string[]>([]);
  // The concept fields the rows were last built from, so a field added while the drawer is open gets a row too.
  const rowsBuiltFor = useRef('');
  const [identityFields, setIdentityFields] = useState<string[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [documentSearch, setDocumentSearch] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  // This source's own AI reading limits; each one left out uses the admin default.
  const [aiSettings, setAiSettings] = useState<Partial<AiExtractionSettings>>({});
  // Kept after the preview is cleared by an edit, so a computed field can still be tried on them.
  const [fieldSamples, setFieldSamples] = useState<Record<string, string[]>>();

  const concept = graph?.nodes.find((node) => node.id === conceptId);
  const defaultsQuery = useQuery({
    queryKey: ['semantic-models', 'extraction-defaults'],
    queryFn: () => semanticModelApi.getExtractionDefaults(),
    enabled: Boolean(target),
    staleTime: 60_000,
  });
  const sourceMappings = useSourceMappings(modelId).data ?? [];
  const assetsQuery = useQuery({
    queryKey: semanticModelQueryKeys.sourceAssets(modelId),
    queryFn: () => semanticModelApi.listSourceAssets(modelId),
    enabled: Boolean(target),
  });
  const documentAssets = useMemo(() => (assetsQuery.data?.assets ?? []).filter((asset) => asset.kind === 'document'), [assetsQuery.data]);
  // Many files of a workspace with one mapping. Editing a saved one reopens it with what it covers.
  const workspace: WorkspaceSourceScope | undefined = target?.workspace ?? (target?.mapping?.scope === 'workspace'
    ? {
      workspaceId: target.mapping.workspaceId,
      name: target.mapping.documentName ?? target.mapping.workspaceId,
      workspaceName: (target.mapping.documentName ?? target.mapping.workspaceId).split(' / ')[0],
      folderIds: target.mapping.selection?.folderIds ?? (target.mapping.folderId ? [target.mapping.folderId] : []),
      documentIds: target.mapping.selection?.documentIds ?? [],
    }
    : undefined);
  const editingWorkspaceMapping = target?.mapping?.scope === 'workspace' ? target.mapping.id : undefined;
  // Every file, or only what is picked in the workspace tree.
  const [coverage, setCoverage] = useState<{ whole: boolean; pick: WorkspacePick }>({ whole: true, pick: { folderIds: [], documentIds: [] } });
  const pickCount = coverage.pick.folderIds.length + coverage.pick.documentIds.length;
  // Some of the covered files, to show beside the fields; the first couple are previewed together.
  const samplesQuery = useQuery({
    queryKey: ['semantic-models', 'workspace-samples', workspace?.workspaceId, coverage.whole ? null : coverage.pick],
    queryFn: async (): Promise<StructuredSourceAsset[]> => {
      const asset = (document: { id: string; originalName: string; mimeType: string; path?: string }): StructuredSourceAsset => ({
        workspaceId: workspace!.workspaceId, documentId: document.id, name: document.originalName,
        kind: 'document', mimeType: document.mimeType, path: document.path ?? '',
      });
      if (!coverage.whole && coverage.pick.documentIds.length) {
        const picked = await Promise.allSettled(coverage.pick.documentIds.slice(0, VIEWER_DOCUMENTS).map((id) => getDocument(workspace!.workspaceId, id)));
        return picked.flatMap((result) => result.status === 'fulfilled' ? [asset(result.value)] : []);
      }
      if (!coverage.whole && !coverage.pick.folderIds.length) return [];
      // Files of the workspace (or of the picked folders), looking into subfolders until there are enough.
      const found: StructuredSourceAsset[] = [];
      const folders: (string | undefined)[] = coverage.whole ? [undefined] : [...coverage.pick.folderIds];
      for (let opened = 0; folders.length && found.length < VIEWER_DOCUMENTS && opened < MAX_SAMPLE_FOLDERS; opened += 1) {
        const folderId = folders.shift();
        const page = folderId
          ? await getFolderContents(workspace!.workspaceId, folderId, { limit: 50, page: 1 })
          : await getDocuments(workspace!.workspaceId, { limit: 50, page: 1 });
        for (const document of page.documents) {
          if (document.isFolder) folders.push(document.id);
          else if (isReadableDocument(document.mimeType) && !found.some((item) => item.documentId === document.id)) found.push(asset(document));
        }
      }
      return found.slice(0, VIEWER_DOCUMENTS);
    },
    enabled: Boolean(workspace),
  });

  useEffect(() => {
    if (!target) return;
    const nextConceptId = target.mapping?.conceptId ?? target.conceptId ?? '';
    const nextConcept = graph?.nodes.find((node) => node.id === nextConceptId);
    setConceptId(nextConceptId);
    const attributes = nextConcept?.attributes ?? [];
    const rows = target.mapping ? withConceptFields(target.mapping.fieldMappings, attributes) : { mappings: attributes.map((attribute) => newDocumentField(attribute.key)), added: [] };
    setMappings(rows.mappings);
    setAddedFields(rows.added);
    rowsBuiltFor.current = `${nextConceptId}:${attributes.map((attribute) => attribute.key).join('|')}`;
    setIdentityFields(target.mapping?.identityFields ?? sourceMappings.find((mapping) => mapping.conceptId === nextConceptId)?.identityFields ?? []);
    setSelectedDocuments(new Set([target.documentId, ...(target.bulkEdit ? sourceMappings.filter((mapping) => mapping.conceptId === nextConceptId && mapping.assetKind === 'document').map((mapping) => mapping.documentId) : [])]));
    setDocumentSearch('');
    setSavedCount(0);
    setAiSettings({ ...target.mapping?.aiSettings });
    setFieldSamples(undefined);
    const startPick = { folderIds: [...(workspace?.folderIds ?? []), ...(workspace?.folderId ? [workspace.folderId] : [])], documentIds: workspace?.documentIds ?? [] };
    setCoverage({ whole: !startPick.folderIds.length && !startPick.documentIds.length, pick: startPick });
    preview.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.documentId, target?.mapping?.id, graph?.versionId, sourceMappings.length]);
  useEffect(() => { saveWorkspace.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [target?.documentId]);
  const conceptFields = concept ? `${concept.id}:${concept.attributes.map((attribute) => attribute.key).join('|')}` : '';
  useEffect(() => {
    if (!target || !concept || !rowsBuiltFor.current || conceptFields === rowsBuiltFor.current) return;
    rowsBuiltFor.current = conceptFields;
    const rows = withConceptFields(mappings, concept.attributes);
    setMappings(rows.mappings);
    setAddedFields((current) => [...current.filter((key) => rows.mappings.some((mapping) => mapping.targetAttribute === key)), ...rows.added]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptFields]);

  const eligibleDocuments = target?.bulkEdit
    ? documentAssets.filter((asset) => sourceMappings.some((mapping) => mapping.conceptId === conceptId && mapping.assetKind === 'document' && mapping.documentId === asset.documentId))
    : documentAssets;
  const filteredDocuments = eligibleDocuments.filter((asset) => asset.name.toLocaleLowerCase().includes(documentSearch.trim().toLocaleLowerCase()));
  const pickedAssets = [...selectedDocuments].map((documentId) => eligibleDocuments.find((asset) => asset.documentId === documentId)
    ?? (documentId === target?.documentId ? {
      workspaceId: target.workspaceId,
      documentId,
      name: target.documentName,
      kind: 'document' as const,
      mimeType: target.mimeType ?? 'application/pdf',
      path: target.path ?? '',
    } : null)).filter((asset): asset is StructuredSourceAsset => Boolean(asset));
  const selectedAssets = workspace ? samplesQuery.data ?? [] : pickedAssets;
  const activeMappings = mappings.filter((mapping) => mapping.mode !== 'ignore');
  // Ignored fields are saved too, so a field left out on purpose is not offered again as a new one.
  const savedMappings = mappings.map((mapping) => mapping.mode === 'computed' && mapping.computed ? { ...mapping, sourceField: null, computed: computedPayload(mapping.computed) } : mapping);

  // A preset or the last mapping replaces the fields' settings; fields the concept no longer has are left out.
  const applySettings = (settings: MappingSettings, exact: boolean) => {
    const attributes = concept?.attributes ?? [];
    const rows = withConceptFields(settings.fieldMappings, attributes);
    setMappings(rows.mappings);
    setAddedFields([]);
    const keys = new Set(attributes.map((attribute) => attribute.key));
    const identity = settings.identityFields.filter((key) => keys.has(key));
    if (exact || identity.length) setIdentityFields(identity);
    setAiSettings({ ...settings.aiSettings });
    preview.reset();
  };

  const preview = useMutation({
    mutationFn: async (): Promise<PreviewItem[]> => {
      const results: PreviewItem[] = [];
      for (const asset of selectedAssets.slice(0, 2)) {
        results.push({
          asset,
          result: await semanticModelApi.previewSourceMapping(modelId, {
            conceptId,
            workspaceId: asset.workspaceId,
            documentId: asset.documentId,
            assetKind: 'document',
            fieldMappings: savedMappings.filter((mapping) => mapping.mode !== 'ignore'),
            identityFields,
            aiSettings,
          }),
        });
      }
      return results;
    },
  });
  const saveWorkspace = useMutation({
    mutationFn: () => semanticModelApi.createWorkspaceSourceMapping(modelId, {
      conceptId,
      workspaceId: workspace!.workspaceId,
      ...(coverage.whole ? {} : coverage.pick),
      mappingId: editingWorkspaceMapping,
      fieldMappings: savedMappings,
      identityFields,
      aiSettings,
    }),
    onSuccess: async (result) => {
      useSemanticModelEditorStore.getState().adoptRevision(result.revision);
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceMappings(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.mappingHealth(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.freshness(modelId) }),
      ]);
      showSuccess(t('mapping.workspaceSaved', { count: result.fileCount }),
        result.waitingCount ? { description: t('mapping.workspaceWaiting', { count: result.waitingCount }) } : undefined);
      onClose();
    },
    onError: (error) => showError(t('mapping.saveError'), { description: parseApiError(error).message }),
  });
  const save = useMutation({
    mutationFn: async () => {
      setSavedCount(0);
      if (selectedAssets.length === 1) return (await semanticModelApi.createSourceMapping(modelId, {
        conceptId,
        workspaceId: selectedAssets[0].workspaceId,
        documentId: selectedAssets[0].documentId,
        sheetName: '',
        assetKind: 'document',
        fieldMappings: savedMappings,
        identityFields,
        aiSettings,
      })).revision;
      let revision: number | undefined;
      for (let start = 0; start < selectedAssets.length; start += 50) {
        const batch = selectedAssets.slice(start, start + 50);
        try {
          revision = (await semanticModelApi.createBulkDocumentSourceMappings(modelId, {
            conceptId,
            documents: batch.map((asset) => ({ workspaceId: asset.workspaceId, documentId: asset.documentId })),
            fieldMappings: savedMappings,
            identityFields,
            aiSettings,
          })).revision;
        } catch (error) {
          if (start) throw new Error(t('dataWorkflow.partialSaved', { count: start }), { cause: error });
          throw error;
        }
        setSavedCount(start + batch.length);
      }
      return revision;
    },
    onSuccess: async (revision) => {
      // Mapping commands advance the model revision; adopt it so the next autosave does not conflict.
      if (revision !== undefined) useSemanticModelEditorStore.getState().adoptRevision(revision);
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceMappings(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.mappingHealth(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
        client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] }),
      ]);
      showSuccess(t('mapping.documentSaved', { count: selectedAssets.length }));
      onClose();
    },
    onError: (error) => {
      void Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceMappings(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.mappingHealth(modelId) }),
      ]);
      showError(t('mapping.saveError'), { description: error instanceof Error ? error.message : undefined });
    },
  });
  const identityValid = identityFields.every((field) => activeMappings.some((mapping) => mapping.targetAttribute === field));
  const usesAi = mappingsUseAi(activeMappings);
  // A rule the runtime would refuse, or a limit out of bounds, is fixed here rather than at run time.
  const rulesValid = activeMappings.every((mapping) => mapping.mode !== 'extract' || !usesRules(mapping.extractionStrategy) || !rulesProblem(mapping.rules));
  const limitsValid = !usesAi || !limitProblem(aiSettings);
  // Fields a computed field can be taken from: the other mapped fields that are not computed themselves.
  const computedInputs = (self: string) => activeMappings.filter((mapping) => mapping.mode !== 'computed' && mapping.targetAttribute !== self).map((mapping) => mapping.targetAttribute);
  const computedProblems = activeMappings.filter((mapping) => mapping.mode === 'computed')
    .map((mapping) => ({ field: mapping.targetAttribute, problem: computedProblem(mapping.computed, computedInputs(mapping.targetAttribute)) }))
    .filter((item) => item.problem);
  const computedValid = !computedProblems.length;
  const saving = save.isPending || saveWorkspace.isPending;
  const canSave = Boolean(conceptId && (workspace ? coverage.whole || pickCount > 0 : selectedAssets.length) && activeMappings.length && identityValid && rulesValid && limitsValid && computedValid) && !saving;
  const canPreview = canSave && selectedAssets.length > 0;
  // File names the computed fields are tried on: the picked or sample documents first, then the others known here.
  // A workspace mapping is tried on its own files only; its name is a folder, not a file.
  const fileSamples = workspace ? selectedAssets.map((asset) => asset.name).slice(0, 20)
    : [...new Set([...selectedAssets.map((asset) => asset.name), target?.documentName ?? '', ...eligibleDocuments.map((asset) => asset.name)].filter(Boolean))].slice(0, 20);
  // Values of each field read by the last document preview, to try a computed field taken from another field.
  useEffect(() => {
    if (!preview.data) return;
    const values: Record<string, string[]> = {};
    for (const { result } of preview.data) {
      for (const [field, reading] of Object.entries(result.fields ?? {})) if (reading.reason === 'found' && reading.value != null) (values[field] ??= []).push(String(reading.value));
      for (const entity of result.entities) for (const [field, value] of Object.entries(entity.values)) if (value != null && !result.fields?.[field]) (values[field] ??= []).push(String(value));
    }
    setFieldSamples(values);
  }, [preview.data]);
  const attributeLabel = (key: string) => concept?.attributes.find((attribute) => attribute.key === key)?.label ?? key;
  // Results read with other rules would mislead: they are cleared as soon as the mapping changes.
  const changeMappings = (next: SourceFieldMapping[]) => { setMappings(next); preview.reset(); };

  const setMode = (index: number, mode: SourceFieldMapping['mode']) => {
    if (mode === 'ignore') setIdentityFields((current) => current.filter((field) => field !== mappings[index]?.targetAttribute));
    changeMappings(mappings.map((mapping, itemIndex) => itemIndex === index ? {
      ...mapping,
      mode,
      sourceField: mode === 'metadata' ? 'document_name' : null,
      constantValue: mode === 'constant' ? mapping.constantValue ?? '' : undefined,
      computed: mode === 'computed' ? mapping.computed ?? newComputedRule() : undefined,
      // A strategy only applies to extracted fields.
      extractionStrategy: mode === 'extract' ? mapping.extractionStrategy ?? 'deterministic' : undefined,
      rules: mode === 'extract' ? mapping.rules : undefined,
    } : mapping).map((mapping, itemIndex) => itemIndex === index && mode !== 'extract' ? withoutAiSettings(mapping) : mapping));
  };

  const setStrategy = (index: number, strategy: SourceExtractionStrategy) => {
    changeMappings(mappings.map((mapping, itemIndex) => itemIndex === index ? withStrategy(mapping, strategy) : mapping));
  };
  const setAllStrategies = (strategy: SourceExtractionStrategy) => {
    changeMappings(mappings.map((mapping) => mapping.mode === 'extract' ? withStrategy(mapping, strategy) : mapping));
  };
  const setAiSettingsOf = (index: number, patch: Pick<SourceFieldMapping, 'semanticDefinition' | 'agentId'>) => {
    changeMappings(mappings.map((mapping, itemIndex) => itemIndex === index ? {
      ...withoutAiSettings(mapping),
      ...(patch.semanticDefinition ? { semanticDefinition: patch.semanticDefinition } : {}),
      ...(patch.agentId ? { agentId: patch.agentId } : {}),
    } : mapping));
  };
  const setRules = (index: number, rules: SourceFieldMapping['rules']) => {
    changeMappings(mappings.map((mapping, itemIndex) => {
      if (itemIndex !== index) return mapping;
      const { rules: _previous, ...rest } = mapping;
      return rules ? { ...rest, rules } : rest;
    }));
  };
  const openQuote = (asset: StructuredSourceAsset, quote: string, page?: number | null) =>
    void useFileViewerStore.getState().openFile(asset.workspaceId, asset.documentId, asset.path, asset.name, asset.mimeType, { page: page ?? 1, highlightText: quote });

  // The document beside the fields, read again with the current rules as they change.
  const [prefs, savePrefs] = useSplitPrefs();
  const narrow = useNarrow();
  const [narrowTab, setNarrowTab] = useState<'document' | 'fields'>('fields');
  const viewerShown = Boolean(target) && (narrow || !prefs.collapsed);
  const viewerDocuments = workspace ? selectedAssets : pickedAssets.slice(0, VIEWER_DOCUMENTS);
  const [shownId, setShownId] = useState<string>();
  const shown = viewerDocuments.find((asset) => asset.documentId === shownId) ?? viewerDocuments[0];
  const [navigation, setNavigation] = useState<DocumentPreviewNavigation | null>(null);
  // Pages of each document the viewer has opened, for the whole-pages control.
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const notePageCount = useCallback((documentId: string, count: number) =>
    setPageCounts((current) => current[documentId] === count ? current : { ...current, [documentId]: count }), []);
  const navigate = (next: Omit<DocumentPreviewNavigation, 'nonce'>) => {
    setNavigation({ ...next, nonce: Date.now() + Math.random() });
    if (narrow) setNarrowTab('document');
  };
  const showDocument = (documentId: string) => { setShownId(documentId); setNavigation(null); };
  useEffect(() => { setShownId(undefined); setNavigation(null); setNarrowTab('fields'); }, [target?.documentId, target?.mapping?.id]);

  // The app's navigation folds away while the document is shown, and comes back after if it was open.
  const appSidebar = useOptionalSidebar();
  const sidebarRef = useRef(appSidebar);
  sidebarRef.current = appSidebar;
  const splitOpen = viewerShown && !narrow;
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!splitOpen || !sidebar?.open) return;
    sidebar.setOpen(false);
    return () => sidebarRef.current?.setOpen(true);
  }, [splitOpen]);

  // Labels and headings shared by up to 10 of the documents, asked once per set of documents.
  const labelDocuments = viewerDocuments.filter((asset) => asset.workspaceId === viewerDocuments[0]?.workspaceId).slice(0, LABEL_DOCUMENTS);
  const labelDocumentIds = labelDocuments.map((asset) => asset.documentId).sort((left, right) => left.localeCompare(right));
  const labelsQuery = useQuery({
    queryKey: ['semantic-models', 'document-labels', modelId, labelDocuments[0]?.workspaceId, labelDocumentIds],
    queryFn: () => semanticModelApi.getDocumentLabels(modelId, { workspaceId: labelDocuments[0].workspaceId, documentIds: labelDocumentIds }),
    enabled: Boolean(target) && labelDocumentIds.length > 0,
    staleTime: Infinity,
    retry: false,
  });
  const unreadIds = new Set(labelsQuery.data?.unread.map((item) => item.assetId) ?? []);
  const previewSuggestion = (suggestion: DocumentLabelSuggestion) => {
    // A page is only meaningful for the documents the labels were read from.
    if (!viewerShown || !shown || !suggestion.page || !labelDocumentIds.includes(shown.documentId) || unreadIds.has(shown.documentId)) return;
    setNavigation({ page: suggestion.page, nonce: Date.now() + Math.random() });
  };
  const suggestions: LabelSuggestions | undefined = labelDocumentIds.length ? {
    status: labelsQuery.isError ? 'error' : labelsQuery.data ? 'ready' : 'loading',
    labels: labelsQuery.data?.labels ?? [],
    documentsRead: labelsQuery.data?.documentsRead ?? 0,
    onRetry: () => void labelsQuery.refetch(),
    onPreview: previewSuggestion,
  } : undefined;

  const live = useLiveDocumentPreview({
    modelId,
    asset: shown,
    draft: canPreview ? { conceptId, fieldMappings: savedMappings.filter((mapping) => mapping.mode !== 'ignore'), identityFields, aiSettings } : null,
    enabled: viewerShown && Boolean(shown),
    // Reading with AI is slow and costly: only on request.
    auto: !usesAi,
  });
  const liveStatus = live.result?.documentStatus && live.result.documentStatus !== 'read' ? live.result.documentStatus : null;
  const showReading = (reading: DocumentFieldReading) => navigate({ page: reading.page ?? undefined, highlightText: highlightOf(reading.quote) });

  return <Sheet modal={false} open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
    {target && <SheetContent side='right' className={cn('flex w-full flex-col gap-0 p-0 transition-[max-width] duration-200', splitOpen ? 'sm:max-w-[min(96vw,1680px)]' : 'sm:max-w-2xl')} onInteractOutside={(event) => event.preventDefault()}>
      <SheetHeader className='relative border-b p-5 pr-24'>
        {!narrow && <Button type='button' size='sm' variant='ghost' className='absolute right-12 top-3.5 h-8 px-2 text-xs' aria-pressed={!prefs.collapsed}
          aria-label={prefs.collapsed ? t('mapping.live.showDocument') : t('mapping.live.hideDocument')} title={prefs.collapsed ? t('mapping.live.showDocument') : t('mapping.live.hideDocument')}
          onClick={() => savePrefs({ collapsed: !prefs.collapsed })}>
          {prefs.collapsed ? <PanelLeftOpen className='h-4 w-4' /> : <PanelLeftClose className='h-4 w-4' />}
        </Button>}
        <SheetTitle>{workspace ? t('mapping.workspaceTitle', { name: workspace.workspaceName ?? workspace.name }) : target.bulkEdit ? t('dataWorkflow.bulkTitle') : target.mapping ? t('mapping.editDocumentTitle') : t('mapping.documentTitle', { name: target.documentName })}</SheetTitle>
        <SheetDescription>{workspace ? t('mapping.workspaceDescription') : target.bulkEdit ? t('dataWorkflow.bulkDescription', { name: target.documentName }) : t('mapping.documentDescription')}</SheetDescription>
      </SheetHeader>
      {narrow && <Tabs value={narrowTab} onValueChange={(value) => setNarrowTab(value as 'document' | 'fields')} className='border-b px-4 py-2'>
        <TabsList className='w-full'>
          <TabsTrigger value='document' className='flex-1 text-xs'><FileText className='mr-1.5 h-3.5 w-3.5' />{t('mapping.live.documentTab')}</TabsTrigger>
          <TabsTrigger value='fields' className='flex-1 text-xs'><ListChecks className='mr-1.5 h-3.5 w-3.5' />{t('mapping.live.fieldsTab')}</TabsTrigger>
        </TabsList>
      </Tabs>}
      {(() => {
        const documentPane = <DocumentPreviewPane documents={viewerDocuments} shown={shown} onShow={showDocument} navigation={navigation} onPageCount={notePageCount} />;
        const fieldsPane = <div className='h-full min-h-0 space-y-6 overflow-y-auto p-5'>
        {viewerShown && shown && <div className='space-y-2' aria-live='polite'>
          <div className='flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground'>
            {live.reading ? <Loader2 className='h-3.5 w-3.5 shrink-0 animate-spin' /> : <FileText className='h-3.5 w-3.5 shrink-0' />}
            <span className='min-w-0 flex-1 truncate'>{!canPreview ? t('mapping.live.incomplete') : live.reading ? t('mapping.live.readingDocument', { name: shown.name }) : live.result ? t('mapping.live.readDocument', { name: shown.name }) : usesAi ? t('mapping.live.aiManual') : t('mapping.live.readingDocument', { name: shown.name })}</span>
            {canPreview && <Button type='button' size='sm' variant='ghost' className='h-6 shrink-0 px-1.5 text-[11px]' disabled={live.reading && !usesAi} onClick={() => void live.run()}>
              <RefreshCw className='mr-1 h-3 w-3' />{usesAi && !live.result ? t('mapping.live.readNow') : t('mapping.live.readAgain')}
            </Button>}
          </div>
          {canPreview && !live.result && live.reading && !live.error && <div className='space-y-1.5' aria-hidden><Skeleton className='h-3 w-2/3' /><Skeleton className='h-3 w-1/2' /></div>}
          {Boolean(live.error) && <p role='alert' className='flex gap-1.5 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{isRetiredSearchFailure(live.error) ? t('mapping.previewUnavailable') : `${t('mapping.previewError')}: ${parseApiError(live.error).message}`}</p>}
          {liveStatus && <p role='alert' className='flex gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-800 dark:text-amber-300'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{documentStatusText(t, liveStatus)}</p>}
          {live.result?.warnings.map((warning) => <p key={warning} className='flex gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{warning}</p>)}
        </div>}
        <FormField label={t('mapping.concept')}>
          <Select value={conceptId} disabled={Boolean(target.mapping)} onValueChange={(value) => {
            setConceptId(value);
            const next = graph?.nodes.find((node) => node.id === value);
            setMappings((next?.attributes ?? []).map((attribute) => newDocumentField(attribute.key)));
            setAddedFields([]);
            rowsBuiltFor.current = `${value}:${(next?.attributes ?? []).map((attribute) => attribute.key).join('|')}`;
            setIdentityFields(sourceMappings.find((mapping) => mapping.conceptId === value)?.identityFields ?? []);
            preview.reset();
          }}>
            <SelectTrigger className={INPUT} aria-label={t('mapping.concept')}><SelectValue placeholder={t('mapping.chooseConcept')} /></SelectTrigger>
            <SelectContent>{(graph?.nodes ?? []).filter((node) => !node.systemKey).map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>

        {workspace && <section className={cn(FORM_SECTION, 'text-xs')}>
          <SectionHeader title={t('mapping.coverage')} help={t('mapping.workspaceHelp')} icon={<FolderOpen className='mr-0.5 h-4 w-4 text-muted-foreground' />} />
          <WorkspaceFilePicker workspaceId={workspace.workspaceId} name={workspace.workspaceName ?? workspace.name} whole={coverage.whole} pick={coverage.pick}
            onChange={(next) => { setCoverage(next); preview.reset(); }} />
          {usesAi && <p className='flex gap-1.5 rounded-lg bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{t('mapping.workspaceAiCost')}</p>}
          {samplesQuery.isSuccess && !selectedAssets.length && <p className='text-muted-foreground'>{t('mapping.workspaceNoSample')}</p>}
        </section>}

        {!workspace && ((target.bulkEdit && eligibleDocuments.length > 1) || (!target.mapping && eligibleDocuments.length > 1)) && <section className={FORM_SECTION}>
          <SectionHeader title={t('mapping.bulkDocuments', { count: selectedAssets.length })} help={t('mapping.bulkDocumentsHelp')} />
          {target.bulkEdit && <p className='text-xs text-muted-foreground'>{t('dataWorkflow.bulkReplaceHelp')}</p>}
          <div className='flex flex-wrap items-center gap-2'>
            <Input className={cn(INPUT, 'min-w-40 flex-1')} value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder={t('dataWorkflow.searchDocuments')} aria-label={t('dataWorkflow.searchDocuments')} />
            <Button size='sm' variant='outline' type='button' className='h-9' onClick={() => setSelectedDocuments((current) => new Set([...current, ...filteredDocuments.map((asset) => asset.documentId)]))}>{t('dataWorkflow.selectAll', { count: filteredDocuments.length })}</Button>
            <Button size='sm' variant='ghost' type='button' className='h-9' onClick={() => setSelectedDocuments((current) => new Set([...current].filter((id) => !filteredDocuments.some((asset) => asset.documentId === id))))}>{t('dataWorkflow.clearSelection')}</Button>
          </div>
          <div className={cn(ROW_LIST, 'max-h-48 overflow-y-auto')}>
            {filteredDocuments.map((asset) => <label key={asset.documentId} className='flex min-h-9 items-center gap-2 px-3 text-xs hover:bg-muted/40'>
              <input type='checkbox' checked={selectedDocuments.has(asset.documentId)} onChange={(event) => setSelectedDocuments((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(asset.documentId); else next.delete(asset.documentId);
                return next;
              })} />
              <span className='truncate'>{asset.name}</span>
            </label>)}
            {!filteredDocuments.length && <p className='p-3 text-xs text-muted-foreground'>{t('dataWorkflow.noDocumentsMatch')}</p>}
          </div>
        </section>}

        {concept && !concept.attributes.length && <p className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('mapping.noFields', { name: concept.label })}</p>}

        {concept && concept.attributes.length > 0 && <section className={FORM_SECTION}>
          <SectionHeader title={t('mapping.documentFields')} count={mappings.length} />
          <MappingPresetBar modelId={modelId} conceptId={conceptId} attributes={concept.attributes}
            current={{ fieldMappings: savedMappings, aiSettings, identityFields }} onApply={applySettings}
            autoStart={Boolean(target && !target.mapping && !target.bulkEdit)} />
          <ReadAllFieldsBar mappings={mappings} onApply={setAllStrategies} />
          {addedFields.length > 0 && <p role='status' className='flex gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/5 p-2.5 text-xs text-sky-800 dark:text-sky-300'>
            <Sparkles className='mt-0.5 h-3.5 w-3.5 shrink-0' />{t('mapping.newFields', { count: addedFields.length, fields: addedFields.map(attributeLabel).join(', ') })}
          </p>}
          <div className={ROW_LIST}>
            {mappings.map((mapping, index) => <div key={mapping.targetAttribute} className='space-y-2 px-3 py-2.5'>
              <div className='flex items-center gap-2'>
                <span className='flex min-w-0 flex-1 items-center gap-1.5 text-xs font-medium'>
                  <span className='truncate'>{concept.attributes.find((attribute) => attribute.key === mapping.targetAttribute)?.label ?? mapping.targetAttribute}</span>
                  {addedFields.includes(mapping.targetAttribute) && <span className='shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:text-sky-300'>{t('mapping.newField')}</span>}
                </span>
                <Select value={mapping.mode} onValueChange={(value: SourceFieldMapping['mode']) => setMode(index, value)}>
                  <SelectTrigger className={cn(INPUT_COMPACT, 'w-40 text-xs')} aria-label={t('mapping.methodFor', { field: mapping.targetAttribute })}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='extract'>{t('mapping.method.extract')}</SelectItem>
                    <SelectItem value='metadata'>{t('mapping.method.metadata')}</SelectItem>
                    <SelectItem value='constant'>{t('mapping.method.constant')}</SelectItem>
                    <SelectItem value='computed'>{t('mapping.method.computed')}</SelectItem>
                    <SelectItem value='ignore'>{t('mapping.method.ignore')}</SelectItem>
                  </SelectContent>
                </Select>
                {mapping.mode === 'extract' && <Select value={mapping.extractionStrategy ?? 'deterministic'} onValueChange={(value: SourceExtractionStrategy) => setStrategy(index, value)}>
                  <SelectTrigger className={cn(INPUT_COMPACT, 'w-40 text-xs')} aria-label={t('mapping.strategyFor', { field: mapping.targetAttribute })}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STRATEGIES.map((strategy) => <SelectItem key={strategy} value={strategy}>{t(`mapping.strategy.${strategy}`)}</SelectItem>)}
                  </SelectContent>
                </Select>}
              </div>
              {viewerShown && shown && (mapping.mode === 'extract' || mapping.mode === 'computed') && !liveStatus && <FieldLiveStatus
                reading={live.result?.fields?.[mapping.targetAttribute]}
                pending={live.reading && (!live.result || live.changed.has(mapping.targetAttribute) || live.changed.size === 0)}
                stale={live.changed.has(mapping.targetAttribute)}
                labels={mapping.mode === 'extract' ? mapping.rules?.labels?.length ? mapping.rules.labels : [attributeLabel(mapping.targetAttribute)] : []}
                onShow={showReading} onFindLabel={(label) => navigate({ highlightText: label })} />}
              {mapping.mode === 'extract' && usesRules(mapping.extractionStrategy) && <FieldRulesEditor fieldLabel={attributeLabel(mapping.targetAttribute)}
                rules={mapping.rules} onChange={(rules) => setRules(index, rules)} suggestions={suggestions}
                pageCount={shown ? pageCounts[shown.documentId] : undefined}
                live={viewerShown && shown && canPreview && !liveStatus ? {
                  reading: live.result?.fields?.[mapping.targetAttribute],
                  pending: live.reading,
                  onRead: () => void live.run(),
                } : undefined} />}
              {mapping.mode === 'extract' && (mapping.extractionStrategy === 'ai' || mapping.extractionStrategy === 'rules_then_ai') && <AiFieldSettings
                fieldLabel={attributeLabel(mapping.targetAttribute)} mapping={mapping}
                attributeDescription={concept.attributes.find((attribute) => attribute.key === mapping.targetAttribute)?.description}
                onChange={(patch) => setAiSettingsOf(index, patch)} />}
              {mapping.mode === 'computed' && <FieldRecipeEditor modelId={modelId} fieldLabel={attributeLabel(mapping.targetAttribute)} rule={mapping.computed ?? newComputedRule()}
                onChange={(computed) => changeMappings(mappings.map((item, itemIndex) => itemIndex === index ? { ...item, computed } : item))}
                fields={computedInputs(mapping.targetAttribute).map((key) => ({ key, label: attributeLabel(key) }))}
                source={{ kind: 'document', fileSamples, fieldSamples }} />}
              {mapping.mode === 'constant' && <Input className={INPUT_COMPACT} value={String(mapping.constantValue ?? '')} onChange={(event) => changeMappings(mappings.map((item, itemIndex) => itemIndex === index ? { ...item, constantValue: event.target.value } : item))} placeholder={t('mapping.constantPlaceholder')} />}
            </div>)}
          </div>
          {usesAi && <ManyRecordsSwitch value={aiSettings} onChange={(next) => { setAiSettings(next); preview.reset(); }} />}
          {usesAi && <AiLimitsEditor defaults={defaultsQuery.data?.aiSettings} value={aiSettings} onChange={(next) => { setAiSettings(next); preview.reset(); }} />}
        </section>}

        {concept && concept.attributes.length > 0 && <section className={FORM_SECTION}>
          <SectionHeader title={t('mapping.identity')} help={t('mapping.identityHelp')} />
          <div className={ROW_LIST}>
            {activeMappings.map((mapping) => {
              const label = concept.attributes.find((attribute) => attribute.key === mapping.targetAttribute)?.label ?? mapping.targetAttribute;
              return <label key={mapping.targetAttribute} className='flex min-h-9 items-center gap-2 px-3 text-xs hover:bg-muted/40'>
                <input type='checkbox' checked={identityFields.includes(mapping.targetAttribute)} onChange={(event) => setIdentityFields((current) => event.target.checked ? [...current, mapping.targetAttribute] : current.filter((field) => field !== mapping.targetAttribute))} />
                <span>{label}</span>
              </label>;
            })}
          </div>
        </section>}

        {preview.isError && <p role='alert' className='flex gap-1.5 rounded-lg bg-destructive/10 p-3 text-xs text-destructive'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{isRetiredSearchFailure(preview.error) ? t('mapping.previewUnavailable') : `${t('mapping.previewError')}: ${parseApiError(preview.error).message}`}</p>}

        {preview.data?.map(({ asset, result }) => <section key={asset.documentId} className={FORM_SECTION}>
          <SectionHeader title={asset.name} icon={<FileText className='mr-0.5 h-4 w-4 text-muted-foreground' />} />
          {result.warnings.map((warning) => <p key={warning} className='flex gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{warning}</p>)}
          {result.aiSent && <p className='text-[11px] text-muted-foreground'>{t(result.aiSent.longDocument ? 'mapping.reading.aiSentLong' : 'mapping.reading.aiSent', {
            blocks: result.aiSent.blocksSent, characters: result.aiSent.charactersSent.toLocaleString(), total: result.aiSent.documentCharacters.toLocaleString() })}</p>}
          {/* Extracted fields say how they were read, or why nothing was found. */}
          {result.fields && activeMappings.filter((mapping) => (mapping.mode === 'extract' || mapping.mode === 'computed') && result.fields?.[mapping.targetAttribute]).map((mapping) =>
            <FieldReadingResult key={mapping.targetAttribute} fieldLabel={attributeLabel(mapping.targetAttribute)} reading={result.fields![mapping.targetAttribute]}
              onOpenQuote={(quote, page) => openQuote(asset, quote, page)} />)}
          {result.entities.map((entity) => Object.entries(entity.values).filter(([field]) => !result.fields?.[field]).map(([field, value]) => {
            const source = entity.provenance.fields?.[field];
            return <div key={field} className='rounded-lg bg-muted/50 p-2 text-xs'>
              <div className='flex items-start justify-between gap-2'><div><p className='font-medium'>{concept?.attributes.find((attribute) => attribute.key === field)?.label ?? field}</p><p>{String(value ?? '')}</p></div>{source?.confidence !== undefined && <span className='text-muted-foreground'>{Math.round(source.confidence * 100)}%</span>}</div>
              {source?.quote && <button type='button' className='mt-1 flex w-full items-start gap-1 text-left text-[11px] text-primary hover:underline' onClick={() => void useFileViewerStore.getState().openFile(asset.workspaceId, asset.documentId, asset.path, asset.name, asset.mimeType, { page: Number.parseInt(source.page ?? '1', 10) || 1, highlightText: source.quote })}><ExternalLink className='mt-0.5 h-3 w-3 shrink-0' />{source.quote}</button>}
            </div>;
          }))}
        </section>)}
        </div>;
        if (!viewerShown) return <div className='min-h-0 flex-1'>{fieldsPane}</div>;
        if (narrow) return <div className='min-h-0 flex-1'>{narrowTab === 'document' ? documentPane : fieldsPane}</div>;
        return <ResizablePanelGroup id='document-mapping-split' orientation='horizontal' className='min-h-0 flex-1'
          defaultLayout={prefs.layout} onLayoutChanged={(layout) => {
            const document = layout.document ?? DEFAULT_SPLIT.document;
            savePrefs({ layout: { document, fields: layout.fields ?? 100 - document } });
          }}>
          <ResizablePanel id='document' defaultSize={`${prefs.layout.document}%`} minSize='30%' className='min-w-0'>{documentPane}</ResizablePanel>
          <ResizableHandle withHandle aria-label={t('mapping.live.resize')} />
          <ResizablePanel id='fields' defaultSize={`${prefs.layout.fields}%`} minSize='30%' className='min-w-0'>{fieldsPane}</ResizablePanel>
        </ResizablePanelGroup>;
      })()}
      <Separator />
      {computedProblems.length > 0 && <p role='status' className='px-4 pt-3 text-xs text-amber-700 dark:text-amber-400'>{t('mapping.computed.saveBlocked', { fields: computedProblems.map((item) => attributeLabel(item.field)).join(', ') })}</p>}
      <div className='flex items-center justify-end gap-2 p-4'>
        <Button variant='outline' onClick={onClose}>{t('action.cancel')}</Button>
        <Button variant='outline' disabled={!canPreview || preview.isPending} onClick={() => preview.mutate()}>{preview.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{t('mapping.previewButton')}</Button>
        <Button disabled={!canSave} onClick={() => (workspace ? saveWorkspace.mutate() : save.mutate())}>{saving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{workspace ? (editingWorkspaceMapping ? t('mapping.save') : t('mapping.workspaceSave')) : target.bulkEdit ? selectedAssets.length === 1 ? t('dataWorkflow.applyToOne') : t('dataWorkflow.applyToSources', { count: selectedAssets.length }) : t('mapping.save')}</Button>
        {save.isPending && selectedAssets.length > 50 && <span className='text-xs text-muted-foreground'>{t('dataWorkflow.saveProgress', { saved: savedCount, total: selectedAssets.length })}</span>}
      </div>
    </SheetContent>}
  </Sheet>;
}

/** True when the preview failed because the retired document search service is gone, which the user cannot fix. */
function isRetiredSearchFailure(error: unknown) {
  return /native search/i.test(parseApiError(error).message);
}

/** A field read by rules alone keeps no AI settings. */
function withStrategy(mapping: SourceFieldMapping, strategy: SourceExtractionStrategy): SourceFieldMapping {
  return strategy === 'deterministic' ? { ...withoutAiSettings(mapping), extractionStrategy: strategy } : { ...mapping, extractionStrategy: strategy };
}
