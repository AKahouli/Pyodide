import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { showError, showSuccess } from '@/lib/notifications';
import { useFileViewerStore } from '@/modules/file-viewer/store';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSourceMappings } from '../../query/hooks';
import { useSemanticModelEditorStore } from '../../store';
import type { SourceFieldMapping, SourceMappingPreviewResponse, StructuredSourceAsset } from '../../types';
import type { SourceMappingTarget } from './SourceMappingDrawer';

type PreviewItem = { asset: StructuredSourceAsset; result: SourceMappingPreviewResponse };

export function DocumentSourceMappingDrawer({ modelId, target, onClose }: Readonly<{ modelId: string; target: SourceMappingTarget | null; onClose: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const [conceptId, setConceptId] = useState('');
  const [mappings, setMappings] = useState<SourceFieldMapping[]>([]);
  const [identityField, setIdentityField] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
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
    })));
    setIdentityField(target.mapping?.identityFields[0] ?? sourceMappings.find((mapping) => mapping.conceptId === nextConceptId)?.identityFields[0] ?? '');
    setSelectedDocuments(new Set([target.documentId]));
    preview.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.documentId, target?.mapping?.id, graph?.versionId, sourceMappings.length]);

  const selectedAssets = [...selectedDocuments].map((documentId) => documentAssets.find((asset) => asset.documentId === documentId)
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
            identityFields: identityField ? [identityField] : [],
          }),
        });
      }
      return results;
    },
    onError: (error) => showError(t('mapping.previewError'), { description: error instanceof Error ? error.message : undefined }),
  });
  const save = useMutation({
    mutationFn: () => selectedAssets.length > 1
      ? semanticModelApi.createBulkDocumentSourceMappings(modelId, {
        conceptId,
        documents: selectedAssets.map((asset) => ({ workspaceId: asset.workspaceId, documentId: asset.documentId })),
        fieldMappings: activeMappings,
        identityFields: identityField ? [identityField] : [],
      })
      : semanticModelApi.createSourceMapping(modelId, {
        conceptId,
        workspaceId: selectedAssets[0].workspaceId,
        documentId: selectedAssets[0].documentId,
        sheetName: '',
        assetKind: 'document',
        fieldMappings: activeMappings,
        identityFields: identityField ? [identityField] : [],
      }),
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
    onError: (error) => showError(t('mapping.saveError'), { description: error instanceof Error ? error.message : undefined }),
  });
  const identityValid = !identityField || activeMappings.some((mapping) => mapping.targetAttribute === identityField);
  const canSave = Boolean(conceptId && selectedAssets.length && activeMappings.length && identityValid) && !save.isPending;

  const setMode = (index: number, mode: SourceFieldMapping['mode']) => {
    if (mode === 'ignore' && mappings[index]?.targetAttribute === identityField) setIdentityField('');
    setMappings(mappings.map((mapping, itemIndex) => itemIndex === index ? {
      ...mapping,
      mode,
      sourceField: mode === 'metadata' ? 'document_name' : null,
      constantValue: mode === 'constant' ? mapping.constantValue ?? '' : undefined,
    } : mapping));
  };

  return <Sheet open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
    {target && <SheetContent side='right' className='flex w-full flex-col gap-0 p-0 sm:max-w-2xl'>
      <SheetHeader className='border-b p-5'>
        <SheetTitle>{target.mapping ? t('mapping.editDocumentTitle') : t('mapping.documentTitle', { name: target.documentName })}</SheetTitle>
        <SheetDescription>{t('mapping.documentDescription')}</SheetDescription>
      </SheetHeader>
      <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-5'>
        <div className='space-y-2'>
          <Label>{t('mapping.concept')}</Label>
          <Select value={conceptId} disabled={Boolean(target.mapping)} onValueChange={(value) => {
            setConceptId(value);
            const next = graph?.nodes.find((node) => node.id === value);
            setMappings((next?.attributes ?? []).map((attribute) => ({ sourceField: null, targetAttribute: attribute.key, mode: 'extract' })));
            setIdentityField(sourceMappings.find((mapping) => mapping.conceptId === value)?.identityFields[0] ?? '');
            preview.reset();
          }}>
            <SelectTrigger aria-label={t('mapping.concept')}><SelectValue placeholder={t('mapping.chooseConcept')} /></SelectTrigger>
            <SelectContent>{(graph?.nodes ?? []).filter((node) => !node.systemKey).map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {!target.mapping && documentAssets.length > 1 && <div className='space-y-2'>
          <Label>{t('mapping.bulkDocuments', { count: selectedDocuments.size })}</Label>
          <p className='text-xs text-muted-foreground'>{t('mapping.bulkDocumentsHelp')}</p>
          <div className='max-h-40 space-y-1 overflow-y-auto rounded-xl border p-2'>
            {documentAssets.map((asset) => <label key={asset.documentId} className='flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs hover:bg-muted/60'>
              <input type='checkbox' checked={selectedDocuments.has(asset.documentId)} disabled={asset.documentId === target.documentId || (!selectedDocuments.has(asset.documentId) && selectedDocuments.size >= 50)} onChange={(event) => setSelectedDocuments((current) => {
                const next = new Set(current);
                if (event.target.checked && next.size < 50) next.add(asset.documentId); else if (asset.documentId !== target.documentId) next.delete(asset.documentId);
                return next;
              })} />
              <span className='truncate'>{asset.name}</span>
            </label>)}
          </div>
        </div>}

        {concept && <div className='space-y-2'>
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
              </div>
              {mapping.mode === 'constant' && <Input value={String(mapping.constantValue ?? '')} onChange={(event) => setMappings(mappings.map((item, itemIndex) => itemIndex === index ? { ...item, constantValue: event.target.value } : item))} placeholder={t('mapping.constantPlaceholder')} />}
            </div>)}
          </div>
        </div>}

        {concept && <div className='space-y-2'>
          <Label>{t('mapping.identity')}</Label>
          <Select value={identityField || '__none'} onValueChange={(value) => setIdentityField(value === '__none' ? '' : value)}>
            <SelectTrigger aria-label={t('mapping.identity')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value='__none'>{t('mapping.identityNone')}</SelectItem>{activeMappings.map((mapping) => <SelectItem key={mapping.targetAttribute} value={mapping.targetAttribute}>{concept.attributes.find((attribute) => attribute.key === mapping.targetAttribute)?.label ?? mapping.targetAttribute}</SelectItem>)}</SelectContent>
          </Select>
        </div>}

        {preview.data?.map(({ asset, result }) => <div key={asset.documentId} className='space-y-2 rounded-xl border p-3'>
          <p className='text-xs font-semibold'>{asset.name}</p>
          {result.warnings.map((warning) => <p key={warning} className='flex gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{warning}</p>)}
          {result.entities.map((entity) => Object.entries(entity.values).map(([field, value]) => {
            const source = entity.provenance.fields?.[field];
            return <div key={field} className='rounded-lg bg-muted/50 p-2 text-xs'>
              <div className='flex items-start justify-between gap-2'><div><p className='font-medium'>{field}</p><p>{String(value ?? '')}</p></div>{source?.confidence !== undefined && <span className='text-muted-foreground'>{Math.round(source.confidence * 100)}%</span>}</div>
              {source?.quote && <button type='button' className='mt-1 flex w-full items-start gap-1 text-left text-[11px] text-primary hover:underline' onClick={() => void useFileViewerStore.getState().openFile(asset.workspaceId, asset.documentId, asset.path, asset.name, asset.mimeType, { page: Number.parseInt(source.page ?? '1', 10) || 1, highlightText: source.quote })}><ExternalLink className='mt-0.5 h-3 w-3 shrink-0' />{source.quote}</button>}
            </div>;
          }))}
        </div>)}
      </div>
      <Separator />
      <div className='flex items-center justify-end gap-2 p-4'>
        <Button variant='outline' onClick={onClose}>{t('action.cancel')}</Button>
        <Button variant='outline' disabled={!canSave || preview.isPending} onClick={() => preview.mutate()}>{preview.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{t('mapping.previewButton')}</Button>
        <Button disabled={!canSave} onClick={() => save.mutate()}>{save.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{t('mapping.save')}</Button>
      </div>
    </SheetContent>}
  </Sheet>;
}
