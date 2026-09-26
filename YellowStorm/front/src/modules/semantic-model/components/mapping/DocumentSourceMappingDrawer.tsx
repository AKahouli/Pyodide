import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useFileViewerStore } from '@/modules/file-viewer/store';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSourceMappings } from '../../query/hooks';
import { useSemanticModelEditorStore } from '../../store';
import type { SourceExtractionStrategy, SourceFieldMapping, SourceMappingPreviewResponse, StructuredSourceAsset } from '../../types';
import type { SourceMappingTarget } from './SourceMappingDrawer';

type PreviewItem = { asset: StructuredSourceAsset; result: SourceMappingPreviewResponse };

export function DocumentSourceMappingDrawer({ modelId, target, onClose }: Readonly<{ modelId: string; target: SourceMappingTarget | null; onClose: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const [conceptId, setConceptId] = useState('');
  const [mappings, setMappings] = useState<SourceFieldMapping[]>([]);
  const [identityFields, setIdentityFields] = useState<string[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [documentSearch, setDocumentSearch] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const concept = graph?.nodes.find((node) => node.id === conceptId);
  const sourceMappings = useSourceMappings(modelId).data ?? [];
  const assetsQuery = useQuery({
    queryKey: semanticModelQueryKeys.sourceAssets(modelId),
    queryFn: () => semanticModelApi.listSourceAssets(modelId),
    enabled: Boolean(target),
  });
  const documentAssets = useMemo(() => (assetsQuery.data?.assets ?? []).filter((asset) => asset.kind === 'document'), [assetsQuery.data]);

  useEffect(() => {
    if (!target) return;
    const nextConceptId = target.mapping?.conceptId ?? target.conceptId ?? '';
    const nextConcept = graph?.nodes.find((node) => node.id === nextConceptId);
    setConceptId(nextConceptId);
    setMappings(target.mapping?.fieldMappings ?? (nextConcept?.attributes ?? []).map((attribute) => ({
      sourceField: attribute.key === 'source_document' ? 'document_name' : null,
      targetAttribute: attribute.key,
      mode: attribute.key === 'source_document' ? 'metadata' : 'extract',
      extractionStrategy: attribute.key === 'source_document' ? undefined : 'deterministic',
    })));
    setIdentityFields(target.mapping?.identityFields ?? sourceMappings.find((mapping) => mapping.conceptId === nextConceptId)?.identityFields ?? []);
    setSelectedDocuments(new Set([target.documentId, ...(target.bulkEdit ? sourceMappings.filter((mapping) => mapping.conceptId === nextConceptId && mapping.assetKind === 'document').map((mapping) => mapping.documentId) : [])]));
    setDocumentSearch('');
    setSavedCount(0);
    preview.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.documentId, target?.mapping?.id, graph?.versionId, sourceMappings.length]);

  const eligibleDocuments = target?.bulkEdit
    ? documentAssets.filter((asset) => sourceMappings.some((mapping) => mapping.conceptId === conceptId && mapping.assetKind === 'document' && mapping.documentId === asset.documentId))
    : documentAssets;
  const filteredDocuments = eligibleDocuments.filter((asset) => asset.name.toLocaleLowerCase().includes(documentSearch.trim().toLocaleLowerCase()));
  const selectedAssets = [...selectedDocuments].map((documentId) => eligibleDocuments.find((asset) => asset.documentId === documentId)
    ?? (documentId === target?.documentId ? {
      workspaceId: target.workspaceId,
      documentId,
      name: target.documentName,
      kind: 'document' as const,
      mimeType: target.mimeType ?? 'application/pdf',
      path: target.path ?? '',
    } : null)).filter((asset): asset is StructuredSourceAsset => Boolean(asset));
  const activeMappings = mappings.filter((mapping) => mapping.mode !== 'ignore');

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
            fieldMappings: activeMappings,
            identityFields,
          }),
        });
      }
      return results;
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      setSavedCount(0);
      if (selectedAssets.length === 1) return semanticModelApi.createSourceMapping(modelId, {
        conceptId,
        workspaceId: selectedAssets[0].workspaceId,
        documentId: selectedAssets[0].documentId,
        sheetName: '',
        assetKind: 'document',
        fieldMappings: activeMappings,
        identityFields,
      });
      for (let start = 0; start < selectedAssets.length; start += 50) {
        const batch = selectedAssets.slice(start, start + 50);
        try {
          await semanticModelApi.createBulkDocumentSourceMappings(modelId, {
            conceptId,
            documents: batch.map((asset) => ({ workspaceId: asset.workspaceId, documentId: asset.documentId })),
            fieldMappings: activeMappings,
            identityFields,
          });
        } catch (error) {
          if (start) throw new Error(t('dataWorkflow.partialSaved', { count: start }), { cause: error });
          throw error;
        }
        setSavedCount(start + batch.length);
      }
    },
    onSuccess: async () => {
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
  const canSave = Boolean(conceptId && selectedAssets.length && activeMappings.length && identityValid) && !save.isPending;

  const setMode = (index: number, mode: SourceFieldMapping['mode']) => {
    if (mode === 'ignore') setIdentityFields((current) => current.filter((field) => field !== mappings[index]?.targetAttribute));
    setMappings(mappings.map((mapping, itemIndex) => itemIndex === index ? {
      ...mapping,
      mode,
      sourceField: mode === 'metadata' ? 'document_name' : null,
      constantValue: mode === 'constant' ? mapping.constantValue ?? '' : undefined,
      // A strategy only applies to extracted fields.
      extractionStrategy: mode === 'extract' ? mapping.extractionStrategy ?? 'deterministic' : undefined,
    } : mapping));
  };

  const setStrategy = (index: number, strategy: SourceExtractionStrategy) => {
    setMappings(mappings.map((mapping, itemIndex) => itemIndex === index ? { ...mapping, extractionStrategy: strategy } : mapping));
  };

  return <Sheet open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
    {target && <SheetContent side='right' className='flex w-full flex-col gap-0 p-0 sm:max-w-2xl'>
      <SheetHeader className='border-b p-5'>
        <SheetTitle>{target.bulkEdit ? t('dataWorkflow.bulkTitle') : target.mapping ? t('mapping.editDocumentTitle') : t('mapping.documentTitle', { name: target.documentName })}</SheetTitle>
        <SheetDescription>{target.bulkEdit ? t('dataWorkflow.bulkDescription', { name: target.documentName }) : t('mapping.documentDescription')}</SheetDescription>
      </SheetHeader>
      <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-5'>
        <div className='space-y-2'>
          <Label>{t('mapping.concept')}</Label>
          <Select value={conceptId} disabled={Boolean(target.mapping)} onValueChange={(value) => {
            setConceptId(value);
            const next = graph?.nodes.find((node) => node.id === value);
            setMappings((next?.attributes ?? []).map((attribute) => ({ sourceField: null, targetAttribute: attribute.key, mode: 'extract', extractionStrategy: 'deterministic' })));
            setIdentityFields(sourceMappings.find((mapping) => mapping.conceptId === value)?.identityFields ?? []);
            preview.reset();
          }}>
            <SelectTrigger aria-label={t('mapping.concept')}><SelectValue placeholder={t('mapping.chooseConcept')} /></SelectTrigger>
            <SelectContent>{(graph?.nodes ?? []).filter((node) => !node.systemKey).map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {((target.bulkEdit && eligibleDocuments.length > 1) || (!target.mapping && eligibleDocuments.length > 1)) && <div className='space-y-2'>
          <Label>{t('mapping.bulkDocuments', { count: selectedAssets.length })}</Label>
          <p className='text-xs text-muted-foreground'>{t('mapping.bulkDocumentsHelp')}</p>
          {target.bulkEdit && <p className='text-xs text-muted-foreground'>{t('dataWorkflow.bulkReplaceHelp')}</p>}
          <div className='flex flex-wrap items-center gap-2'>
            <Input className='min-w-40 flex-1' value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder={t('dataWorkflow.searchDocuments')} aria-label={t('dataWorkflow.searchDocuments')} />
            <Button size='sm' variant='outline' type='button' onClick={() => setSelectedDocuments((current) => new Set([...current, ...filteredDocuments.map((asset) => asset.documentId)]))}>{t('dataWorkflow.selectAll', { count: filteredDocuments.length })}</Button>
            <Button size='sm' variant='ghost' type='button' onClick={() => setSelectedDocuments((current) => new Set([...current].filter((id) => !filteredDocuments.some((asset) => asset.documentId === id))))}>{t('dataWorkflow.clearSelection')}</Button>
          </div>
          <div className='max-h-48 space-y-1 overflow-y-auto rounded-xl border p-2'>
            {filteredDocuments.map((asset) => <label key={asset.documentId} className='flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs hover:bg-muted/60'>
              <input type='checkbox' checked={selectedDocuments.has(asset.documentId)} onChange={(event) => setSelectedDocuments((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(asset.documentId); else next.delete(asset.documentId);
                return next;
              })} />
              <span className='truncate'>{asset.name}</span>
            </label>)}
            {!filteredDocuments.length && <p className='p-2 text-xs text-muted-foreground'>{t('dataWorkflow.noDocumentsMatch')}</p>}
          </div>
        </div>}

        {concept && !concept.attributes.length && <p className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('mapping.noFields', { name: concept.label })}</p>}

        {concept && concept.attributes.length > 0 && <div className='space-y-2'>
          <Label>{t('mapping.documentFields')}</Label>
          <div className='overflow-hidden rounded-xl border'>
            {mappings.map((mapping, index) => <div key={mapping.targetAttribute} className='space-y-2 border-b p-3 last:border-b-0'>
              <div className='flex items-center gap-3'>
                <span className='min-w-0 flex-1 truncate text-xs font-medium'>{concept.attributes.find((attribute) => attribute.key === mapping.targetAttribute)?.label ?? mapping.targetAttribute}</span>
                <Select value={mapping.mode} onValueChange={(value: SourceFieldMapping['mode']) => setMode(index, value)}>
                  <SelectTrigger className='h-8 w-44 text-xs' aria-label={t('mapping.methodFor', { field: mapping.targetAttribute })}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='extract'>{t('mapping.method.extract')}</SelectItem>
                    <SelectItem value='metadata'>{t('mapping.method.metadata')}</SelectItem>
                    <SelectItem value='constant'>{t('mapping.method.constant')}</SelectItem>
                    <SelectItem value='ignore'>{t('mapping.method.ignore')}</SelectItem>
                  </SelectContent>
                </Select>
                {mapping.mode === 'extract' && <Select value={mapping.extractionStrategy ?? 'deterministic'} onValueChange={(value: SourceExtractionStrategy) => setStrategy(index, value)}>
                  <SelectTrigger className='h-8 w-40 text-xs' aria-label={t('mapping.strategyFor', { field: mapping.targetAttribute })}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='deterministic'>{t('mapping.strategy.deterministic')}</SelectItem>
                    <SelectItem value='ai'>{t('mapping.strategy.ai')}</SelectItem>
                  </SelectContent>
                </Select>}
              </div>
              {mapping.mode === 'constant' && <Input value={String(mapping.constantValue ?? '')} onChange={(event) => setMappings(mappings.map((item, itemIndex) => itemIndex === index ? { ...item, constantValue: event.target.value } : item))} placeholder={t('mapping.constantPlaceholder')} />}
            </div>)}
          </div>
        </div>}

        {concept && concept.attributes.length > 0 && <div className='space-y-2'>
          <Label>{t('mapping.identity')}</Label>
          <div className='space-y-1 rounded-xl border p-2'>
            {activeMappings.map((mapping) => {
              const label = concept.attributes.find((attribute) => attribute.key === mapping.targetAttribute)?.label ?? mapping.targetAttribute;
              return <label key={mapping.targetAttribute} className='flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs hover:bg-muted/60'>
                <input type='checkbox' checked={identityFields.includes(mapping.targetAttribute)} onChange={(event) => setIdentityFields((current) => event.target.checked ? [...current, mapping.targetAttribute] : current.filter((field) => field !== mapping.targetAttribute))} />
                <span>{label}</span>
              </label>;
            })}
          </div>
        </div>}

        {preview.isError && <p role='alert' className='flex gap-1.5 rounded-lg bg-destructive/10 p-3 text-xs text-destructive'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{isRetiredSearchFailure(preview.error) ? t('mapping.previewUnavailable') : `${t('mapping.previewError')}: ${parseApiError(preview.error).message}`}</p>}

        {preview.data?.map(({ asset, result }) => <div key={asset.documentId} className='space-y-2 rounded-xl border p-3'>
          <p className='text-xs font-semibold'>{asset.name}</p>
          {result.warnings.map((warning) => <p key={warning} className='flex gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{warning}</p>)}
          {result.entities.map((entity) => Object.entries(entity.values).map(([field, value]) => {
            const source = entity.provenance.fields?.[field];
            return <div key={field} className='rounded-lg bg-muted/50 p-2 text-xs'>
              <div className='flex items-start justify-between gap-2'><div><p className='font-medium'>{concept?.attributes.find((attribute) => attribute.key === field)?.label ?? field}</p><p>{String(value ?? '')}</p></div>{source?.confidence !== undefined && <span className='text-muted-foreground'>{Math.round(source.confidence * 100)}%</span>}</div>
              {source?.quote && <button type='button' className='mt-1 flex w-full items-start gap-1 text-left text-[11px] text-primary hover:underline' onClick={() => void useFileViewerStore.getState().openFile(asset.workspaceId, asset.documentId, asset.path, asset.name, asset.mimeType, { page: Number.parseInt(source.page ?? '1', 10) || 1, highlightText: source.quote })}><ExternalLink className='mt-0.5 h-3 w-3 shrink-0' />{source.quote}</button>}
            </div>;
          }))}
        </div>)}
      </div>
      <Separator />
      <div className='flex items-center justify-end gap-2 p-4'>
        <Button variant='outline' onClick={onClose}>{t('action.cancel')}</Button>
        <Button variant='outline' disabled={!canSave || preview.isPending} onClick={() => preview.mutate()}>{preview.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{t('mapping.previewButton')}</Button>
        <Button disabled={!canSave} onClick={() => save.mutate()}>{save.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{target.bulkEdit ? selectedAssets.length === 1 ? t('dataWorkflow.applyToOne') : t('dataWorkflow.applyToSources', { count: selectedAssets.length }) : t('mapping.save')}</Button>
        {save.isPending && selectedAssets.length > 50 && <span className='text-xs text-muted-foreground'>{t('dataWorkflow.saveProgress', { saved: savedCount, total: selectedAssets.length })}</span>}
      </div>
    </SheetContent>}
  </Sheet>;
}

/** True when the preview failed because the retired document search service is gone, which the user cannot fix. */
function isRetiredSearchFailure(error: unknown) {
  return /native search/i.test(parseApiError(error).message);
}
