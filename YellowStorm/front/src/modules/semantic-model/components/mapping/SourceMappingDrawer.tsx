import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { showError, showSuccess } from '@/lib/notifications';
import { parseApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSourceMappings } from '../../query/hooks';
import { useSemanticModelEditorStore } from '../../store';
import type { KnowledgeResource } from '../../hooks/use-knowledge-linking';
import type { ConceptSourceMapping, SourceFieldMapping, SheetProfile } from '../../types';
import { DocumentSourceMappingDrawer } from './DocumentSourceMappingDrawer';
import type { SuggestionSource } from '../editor/SuggestConceptsDialog';
import { FORM_SECTION, FormField, INPUT, INPUT_COMPACT, ROW_LIST, SectionHeader } from '../form/FormParts';

export interface SourceMappingTarget {
  workspaceId: string;
  documentId: string;
  documentName: string;
  assetKind: 'excel_sheet' | 'csv' | 'document';
  mimeType?: string;
  path?: string;
  conceptId?: string;
  mapping?: ConceptSourceMapping;
  bulkEdit?: boolean;
  /** Map many files of this workspace at once: all of them, or picked folders and files. */
  workspace?: WorkspaceSourceScope;
}

export interface WorkspaceSourceScope {
  workspaceId: string;
  /** The name shown for the source ("Legal", or "Legal / Contracts" when opened from a folder). */
  name: string;
  /** The workspace's own name, for "every file in …". */
  workspaceName?: string;
  /** Opened from a folder: that folder starts picked. */
  folderId?: string | null;
  /** What is picked to start with; nothing means the whole workspace. */
  folderIds?: string[];
  documentIds?: string[];
}

/** A target that maps many readable files of a workspace with one mapping. */
export function sourceMappingTargetFromWorkspace(scope: WorkspaceSourceScope, conceptId?: string): SourceMappingTarget {
  return {
    workspaceId: scope.workspaceId,
    documentId: `workspace:${scope.workspaceId}:${scope.folderId || 'all'}`,
    documentName: scope.name,
    assetKind: 'document',
    conceptId,
    workspace: scope,
  };
}

export function sourceMappingTargetFromResource(resource: Extract<KnowledgeResource, { kind: 'document' }>, conceptId?: string): SourceMappingTarget {
  return {
    workspaceId: resource.workspaceId,
    documentId: resource.documentId,
    documentName: resource.name,
    assetKind: resource.structured ? (resource.mimeType?.includes('csv') ? 'csv' : 'excel_sheet') : 'document',
    mimeType: resource.mimeType,
    path: resource.path,
    conceptId,
  };
}

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function SourceMappingDrawer({ onSuggestConcepts, ...props }: Readonly<{ modelId: string; target: SourceMappingTarget | null; onClose: () => void; onSuggestConcepts?: (source: SuggestionSource) => void }>) {
  if (props.target?.assetKind === 'document') return <DocumentSourceMappingDrawer {...props} />;
  return <StructuredSourceMappingDrawer {...props} onSuggestConcepts={onSuggestConcepts} />;
}

function StructuredSourceMappingDrawer({ modelId, target, onClose, onSuggestConcepts }: Readonly<{ modelId: string; target: SourceMappingTarget | null; onClose: () => void; onSuggestConcepts?: (source: SuggestionSource) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const nodes = useMemo(() => graph?.nodes.filter((node) => !node.systemKey) ?? [], [graph]);
  const sourceMappings = useSourceMappings(modelId).data ?? [];
  const [conceptId, setConceptId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [mappings, setMappings] = useState<SourceFieldMapping[]>([]);
  const [identityField, setIdentityField] = useState('');
  const [suggestedKeys, setSuggestedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!target) return;
    setConceptId(target.mapping?.conceptId ?? target.conceptId ?? '');
    setSheetName(target.mapping?.sheetName ?? '');
    setMappings(target.mapping?.fieldMappings ?? []);
    setIdentityField(target.mapping?.identityFields[0] ?? '');
    setSuggestedKeys(new Set());
    preview.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.workspaceId, target?.documentId, target?.mapping?.id]);

  const profile = useQuery({
    queryKey: semanticModelQueryKeys.sourceAssetProfile(modelId, target?.documentId ?? 'none', sheetName || undefined),
    queryFn: () => semanticModelApi.profileSourceAsset(modelId, target!.documentId, target!.workspaceId, sheetName || undefined),
    enabled: Boolean(target),
  });

  const analyze = useMutation({
    mutationFn: () => semanticModelApi.analyzeSourceAsset(
      modelId, target!.documentId, target!.workspaceId, sheetName || undefined,
    ),
    onSuccess: (data) => client.setQueryData(
      semanticModelQueryKeys.sourceAssetProfile(modelId, target!.documentId, sheetName || undefined),
      data,
    ),
    onError: (error) => showError(t('sourceAnalysis.error'), { description: parseApiError(error).message }),
  });

  // A spreadsheet is usable as soon as it is uploaded: when it has not been read yet, read it now
  // instead of asking the user to start an analysis.
  const readKey = `${target?.documentId ?? ''}|${sheetName}`;
  const [autoRead, setAutoRead] = useState('');
  const unread = profile.isError || (profile.data && !profile.data.sheets.length && !sheetName);
  useEffect(() => {
    if (!target || !unread || analyze.isPending || autoRead === readKey) return;
    setAutoRead(readKey);
    analyze.mutate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, readKey]);
  const reading = profile.isLoading || analyze.isPending;

  const fields = sheetName ? profile.data?.fields ?? [] : [];

  // Deterministic first-pass suggestions: normalized name equality, identity = first fully populated unique field.
  useEffect(() => {
    if (!target || target.mapping || !fields.length || !conceptId) return;
    const attributes = nodes.find((node) => node.id === conceptId)?.attributes ?? [];
    const byNormalizedTarget = new Map<string, string>();
    for (const attribute of attributes) {
      if (!byNormalizedTarget.has(normalizeName(attribute.key))) byNormalizedTarget.set(normalizeName(attribute.key), attribute.key);
      if (!byNormalizedTarget.has(normalizeName(attribute.label))) byNormalizedTarget.set(normalizeName(attribute.label), attribute.key);
    }
    const suggested: SourceFieldMapping[] = fields.map((field) => {
      const match = byNormalizedTarget.get(normalizeName(field.name));
      return { sourceField: field.name, targetAttribute: match ?? '', mode: match ? 'direct' : 'ignore' };
    });
    setMappings(suggested);
    setSuggestedKeys(new Set(suggested.filter((mapping) => mapping.mode === 'direct').map((mapping) => mapping.sourceField ?? '')));
    const existingIdentity = sourceMappings.find((mapping) => mapping.conceptId === conceptId)?.identityFields[0];
    const identityCandidate = fields.find((field) => field.uniqueRatio === 1 && field.populatedRatio === 1 && suggested.some((mapping) => mapping.sourceField === field.name && mapping.mode === 'direct'));
    const candidateTarget = suggested.find((mapping) => mapping.sourceField === identityCandidate?.name)?.targetAttribute;
    setIdentityField(existingIdentity && suggested.some((mapping) => mapping.targetAttribute === existingIdentity) ? existingIdentity : candidateTarget ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.map((field) => field.name).join('|'), sheetName, conceptId, target?.documentId, target?.mapping?.id]);

  // A saved mapping keeps only its mapped columns: list the sheet's other columns too (left unmapped),
  // so a column ignored at first, or added by a newer reader, can still be mapped.
  const fieldNames = fields.map((field) => field.name).join('|');
  useEffect(() => {
    if (!target?.mapping || !fieldNames) return;
    setMappings((current) => {
      const listed = new Set(current.map((mapping) => mapping.sourceField));
      const unlisted = fieldNames.split('|').filter((name) => !listed.has(name));
      return unlisted.length
        ? [...current, ...unlisted.map((name): SourceFieldMapping => ({ sourceField: name, targetAttribute: '', mode: 'ignore' }))]
        : current;
    });
  }, [fieldNames, target?.mapping]);

  const activeMappings = mappings.filter((mapping) => mapping.mode !== 'ignore');

  const preview = useMutation({
    mutationFn: () => semanticModelApi.previewSourceMapping(modelId, {
      conceptId,
      workspaceId: target!.workspaceId,
      documentId: target!.documentId,
      sheetName,
      assetKind: target!.assetKind,
      fieldMappings: activeMappings,
      identityFields: identityField ? [identityField] : [],
    }),
    onError: (error) => showError(t('mapping.previewError'), { description: error instanceof Error ? error.message : undefined }),
  });

  const save = useMutation({
    mutationFn: async () => {
      const result = await semanticModelApi.createSourceMapping(modelId, {
        conceptId,
        workspaceId: target!.workspaceId,
        documentId: target!.documentId,
        sheetName,
        assetKind: target!.assetKind,
        fieldMappings: activeMappings,
        identityFields: identityField ? [identityField] : [],
      });
      return result;
    },
    onSuccess: async (result) => {
      // The mapping command advanced the model revision; adopt it so the next autosave does not conflict.
      useSemanticModelEditorStore.getState().adoptRevision(result.revision);
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceMappings(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.mappingHealth(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.freshness(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
        client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] }),
      ]);
      showSuccess(t('mapping.saved', { name: target!.documentName }));
      onClose();
    },
    onError: (error) => showError(t('mapping.saveError'), { description: error instanceof Error ? error.message : undefined }),
  });

  const identityValid = !identityField || activeMappings.some((mapping) => mapping.targetAttribute === identityField);
  const canSave = Boolean(conceptId && sheetName && activeMappings.length && identityValid) && !save.isPending;

  return (
    <Sheet modal={false} open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {target && (
        <SheetContent side='right' className='flex w-full flex-col gap-0 p-0 sm:max-w-xl' onInteractOutside={(event) => event.preventDefault()}>
          <SheetHeader className='border-b p-5'>
            <SheetTitle>{target.mapping ? t('mapping.editTitle') : t('mapping.title', { name: target.documentName })}</SheetTitle>
            <SheetDescription>{t('mapping.description')}</SheetDescription>
            {onSuggestConcepts && !target.mapping && (target.assetKind === 'excel_sheet' || target.assetKind === 'csv') && <Button size='sm' variant='outline' className='mt-2 w-fit' onClick={() => onSuggestConcepts({ workspaceId: target.workspaceId, documentId: target.documentId, documentName: target.documentName, assetKind: target.assetKind as SuggestionSource['assetKind'] })}><Sparkles className='mr-2 h-4 w-4' />{t('suggest.openFromFile')}</Button>}
          </SheetHeader>
          <div className='min-h-0 flex-1 space-y-6 overflow-y-auto p-5'>
            <div className='space-y-4'>
              <FormField label={t('mapping.concept')}>
                <Select value={conceptId} onValueChange={(value) => { setConceptId(value); setMappings([]); setIdentityField(sourceMappings.find((mapping) => mapping.conceptId === value)?.identityFields[0] ?? ''); preview.reset(); }} disabled={Boolean(target.mapping)}>
                  <SelectTrigger className={INPUT} aria-label={t('mapping.concept')}><SelectValue placeholder={t('mapping.chooseConcept')} /></SelectTrigger>
                  <SelectContent>{nodes.map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}</SelectContent>
                </Select>
              </FormField>
              <FormField label={t('mapping.sheet')}>
                <Select value={sheetName} onValueChange={(value) => { setSheetName(value); setMappings([]); setIdentityField(''); preview.reset(); }} disabled={Boolean(target.mapping)}>
                  <SelectTrigger className={INPUT} aria-label={t('mapping.sheet')}><SelectValue placeholder={t('mapping.chooseSheet')} /></SelectTrigger>
                  <SelectContent>{(profile.data?.sheets ?? []).map((sheet) => (
                    <SelectItem key={sheet.name} value={sheet.name}>{sheet.name}{sheet.rowCount || sheet.fieldCount ? ` · ${t('mapping.sheetMeta', { rows: sheet.rowCount, fields: sheet.fieldCount })}` : ''}</SelectItem>
                  ))}</SelectContent>
                </Select>
                {reading && <div className='flex items-center gap-2 text-xs text-muted-foreground'><Loader2 className='h-3.5 w-3.5 animate-spin' />{t('sourceAnalysis.loading')}</div>}
                {/* Shown once the file was read and still gave no sheets, or reading it failed. */}
                {!reading && unread && (analyze.isError || autoRead === readKey) && (
                  <div className='flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2 text-xs text-destructive'>
                    <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
                    <span className='min-w-0 flex-1'>{t('sourceAnalysis.readFailed')}</span>
                    <Button size='sm' variant='ghost' className='h-6 shrink-0 px-2 text-[11px]' disabled={analyze.isPending} onClick={() => analyze.mutate()}>
                      {analyze.isPending ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}{t('sourceAnalysis.retry')}
                    </Button>
                  </div>
                )}
              </FormField>
            </div>

            {sheetName && (
              <section className={FORM_SECTION}>
                <SectionHeader title={t('mapping.fields')} help={t('mapping.fieldsHelp')} count={activeMappings.length || undefined} />
                {profile.data && !profile.data.complete && <p className='text-xs text-amber-700 dark:text-amber-400'>{t('sourceAnalysis.boundedSample')}</p>}
                {mappings.length > 0 && <ul className={ROW_LIST}>
                  {mappings.map((mapping, index) => {
                    const suggested = suggestedKeys.has(mapping.sourceField ?? '');
                    return (
                      <li key={mapping.sourceField ?? index} className='flex items-center gap-2 px-3 py-1.5'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-1 truncate text-sm font-medium'>{mapping.sourceField}
                            {suggested && <Badge variant='outline' className='gap-0.5 px-1 py-0 text-[9px] text-primary'><Sparkles className='h-2.5 w-2.5' />{t('mapping.suggested')}</Badge>}
                          </div>
                          <p className='truncate text-[11px] text-muted-foreground'>{fields.find((field) => field.name === mapping.sourceField)?.sample}</p>
                        </div>
                        <Select value={mapping.mode === 'direct' ? mapping.targetAttribute : '__ignore'}
                          onValueChange={(value) => {
                            if (identityField === mapping.targetAttribute && value !== mapping.targetAttribute) setIdentityField('');
                            setMappings(mappings.map((item, itemIndex) => itemIndex === index
                              ? value === '__ignore' ? { ...item, targetAttribute: '', mode: 'ignore' }
                                : { ...item, targetAttribute: value, mode: 'direct' } : item));
                          }}>
                          <SelectTrigger className={cn(INPUT_COMPACT, 'w-44 shrink-0')} aria-label={t('mapping.targetFor', { field: mapping.sourceField ?? '' })}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value='__ignore'>{t('mapping.ignore')}</SelectItem>
                            {(nodes.find((node) => node.id === conceptId)?.attributes ?? []).map((attribute) => (
                              <SelectItem key={attribute.key} value={attribute.key}>{attribute.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </li>
                    );
                  })}
                </ul>}
              </section>
            )}

            {sheetName && (
              <section className={FORM_SECTION}>
                <SectionHeader title={t('mapping.identity')} help={t('mapping.identityHelp')} />
                <Select value={identityField || '__none'} onValueChange={(value) => setIdentityField(value === '__none' ? '' : value)}>
                  <SelectTrigger className={INPUT} aria-label={t('mapping.identity')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__none'>{t('mapping.identityNone')}</SelectItem>
                    {mappings.filter((mapping) => mapping.mode === 'direct').map((mapping) => (
                      <SelectItem key={mapping.targetAttribute} value={mapping.targetAttribute}>{nodes.find((node) => node.id === conceptId)?.attributes.find((attribute) => attribute.key === mapping.targetAttribute)?.label ?? mapping.targetAttribute}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {preview.data?.identityEvidence.map((evidence) => (
                  <p key={evidence.name} className='text-xs text-muted-foreground'>
                    {t('mapping.identityEvidence', { name: evidence.name, unique: Math.round(evidence.uniqueRatio * 100), populated: Math.round(evidence.populatedRatio * 100) })}
                  </p>
                ))}
              </section>
            )}

            {preview.data && (
              <section className={FORM_SECTION}>
                <SectionHeader title={t('mapping.preview', { count: preview.data.stats.resolvedEntities })} />
                {preview.data.warnings.map((warning) => (
                  <p key={warning} className='flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'><AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />{warning}</p>
                ))}
                <ScrollArea className='max-h-56 rounded-lg border'>
                  <div className='divide-y'>
                    {preview.data.entities.map((entity) => (
                      <div key={entity.entityKey} className='px-3 py-2'>
                        <p className='truncate text-sm font-medium'>{entity.label || t('mapping.unnamedEntity')}</p>
                        <p className='truncate text-[11px] text-muted-foreground'>
                          {Object.entries(entity.values).filter(([key]) => key !== entity.label).slice(0, 4).map(([key, value]) => `${key}: ${String(value ?? '')}`).join(' · ')}
                        </p>
                        <p className='text-[11px] text-muted-foreground'>{t('mapping.provenance', { row: entity.provenance.rowNumber })}</p>
                      </div>
                    ))}
                    {!preview.data.entities.length && <p className='p-3 text-xs text-muted-foreground'>{t('mapping.noEntities')}</p>}
                  </div>
                </ScrollArea>
              </section>
            )}
          </div>
          <Separator />
          <div className='flex items-center justify-end gap-2 p-4'>
            <Button variant='outline' onClick={onClose}>{t('action.cancel')}</Button>
            <Button variant='outline' disabled={!canSave || preview.isPending} onClick={() => preview.mutate()}>
              {preview.isPending ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}{t('mapping.previewButton')}
            </Button>
            <Button disabled={!canSave} onClick={() => void save.mutateAsync()}>
              {save.isPending ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}{t('mapping.save')}
            </Button>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}
