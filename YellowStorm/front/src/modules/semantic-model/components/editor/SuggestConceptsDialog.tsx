import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSemanticModelEditorStore, waitForGraphSave } from '../../store';
import type { SemanticNodeType, SemanticRelationType } from '../../types';
import { nextConceptPosition, uniqueBusinessKey } from '../../utils/model-utils';
import { suggestModel, type ConceptProposal, type RelationProposal, type SheetSample } from '../../utils/source-suggestions';

export interface SuggestionSource {
  workspaceId: string;
  documentId: string;
  documentName: string;
  assetKind: 'excel_sheet' | 'csv';
}

const MAX_SHEETS = 10;

interface EditableConcept extends ConceptProposal { include: boolean; excluded: string[] }
interface EditableRelation extends RelationProposal { include: boolean }

/** Every sheet of the file with its columns and sample rows, analysing the file first when it has not been read yet. */
async function loadSamples(modelId: string, source: SuggestionSource): Promise<SheetSample[]> {
  let overview = await semanticModelApi.profileSourceAsset(modelId, source.documentId, source.workspaceId);
  if (!overview.sheets?.length) overview = await semanticModelApi.analyzeSourceAsset(modelId, source.documentId, source.workspaceId);
  const samples: SheetSample[] = [];
  for (const sheet of (overview.sheets ?? []).slice(0, MAX_SHEETS)) {
    // A sheet not read yet answers 404: read it now. One that cannot be read (a notes sheet with no table) is skipped.
    let profile = await semanticModelApi.profileSourceAsset(modelId, source.documentId, source.workspaceId, sheet.name).catch(() => null);
    if (!profile?.fields?.length) profile = await semanticModelApi.analyzeSourceAsset(modelId, source.documentId, source.workspaceId, sheet.name).catch(() => null);
    if (profile?.fields?.length) samples.push({ sheet: sheet.name, fields: profile.fields, sampleRows: profile.sampleRows ?? [] });
  }
  if (!samples.length) throw new Error('no_readable_sheet');
  return samples;
}

export function SuggestConceptsDialog({ modelId, open, onOpenChange, source: initialSource }: Readonly<{
  modelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: SuggestionSource | null;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const [source, setSource] = useState<SuggestionSource | null>(initialSource ?? null);
  const [concepts, setConcepts] = useState<EditableConcept[]>([]);
  const [relations, setRelations] = useState<EditableRelation[]>([]);
  const [applying, setApplying] = useState(false);
  useEffect(() => { if (open) setSource(initialSource ?? null); }, [initialSource, open]);

  const assets = useQuery({
    queryKey: semanticModelQueryKeys.sourceAssets(modelId),
    queryFn: () => semanticModelApi.listSourceAssets(modelId),
    enabled: open && !initialSource,
  });
  const spreadsheets = (assets.data?.assets ?? []).filter((asset) => asset.kind === 'excel_sheet' || asset.kind === 'csv');
  const samples = useQuery({
    queryKey: ['semantic-models', 'source-suggestions', modelId, source?.documentId ?? 'none'],
    queryFn: () => loadSamples(modelId, source!),
    enabled: open && Boolean(source),
    retry: false,
  });
  useEffect(() => {
    if (!samples.data) return;
    const proposal = suggestModel(samples.data);
    setConcepts(proposal.concepts.map((concept) => ({ ...concept, include: true, excluded: [] })));
    setRelations(proposal.relations.map((relation) => ({ ...relation, include: true })));
  }, [samples.data]);

  const bySheet = useMemo(() => new Map(concepts.map((concept) => [concept.sheet, concept])), [concepts]);
  const editConcept = (sheet: string, changes: Partial<EditableConcept>) => setConcepts((current) => current.map((concept) => concept.sheet === sheet ? { ...concept, ...changes } : concept));
  const usableRelations = relations.filter((relation) => {
    const from = bySheet.get(relation.fromSheet);
    const to = bySheet.get(relation.toSheet);
    return from?.include && to?.include && to.keyColumn && !from.excluded.includes(relation.fromColumn) && !to.excluded.includes(to.keyColumn);
  });

  const apply = async () => {
    const state = useSemanticModelEditorStore.getState();
    if (!state.graph || !source) return;
    setApplying(true);
    try {
      const links = await semanticModelApi.workspaces(modelId);
      if (!links.some((link) => link.workspaceId === source.workspaceId && link.enabled) || !links.some((link) => link.role === 'origin' && link.enabled)) {
        await semanticModelApi.connectWorkspace(modelId, source.workspaceId, false);
        useSemanticModelEditorStore.getState().adoptRevision((await semanticModelApi.get(modelId)).revision);
      }
      const nodes: SemanticNodeType[] = [...state.graph.nodes];
      const created = concepts.filter((concept) => concept.include && concept.label.trim()).map((concept) => {
        const node: SemanticNodeType = {
          id: crypto.randomUUID(), key: uniqueBusinessKey(concept.label, nodes.map((item) => item.key)), label: concept.label.trim(),
          description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [],
          attributes: concept.fields.filter((field) => !concept.excluded.includes(field.column)).map((field) => ({ key: field.key, label: field.label, type: field.type, required: false })),
          position: nextConceptPosition(nodes),
        };
        nodes.push(node);
        return { concept, node };
      });
      const createdBySheet = new Map(created.map((item) => [item.concept.sheet, item]));
      const relationKeys = state.graph.relations.map((relation) => relation.key);
      const newRelations = usableRelations.filter((relation) => relation.include).flatMap((relation) => {
        const from = createdBySheet.get(relation.fromSheet);
        const to = createdBySheet.get(relation.toSheet);
        if (!from || !to) return [];
        const key = uniqueBusinessKey(`${from.node.key}_${to.node.key}`, relationKeys);
        relationKeys.push(key);
        const entity: SemanticRelationType = {
          id: crypto.randomUUID(), key, label: t('suggest.belongsTo'), inverseLabel: t('suggest.has'), description: '',
          sourceNodeTypeId: from.node.id, targetNodeTypeId: to.node.id, cardinality: 'many_to_one', traversable: true, filterable: true, attributes: [],
        };
        return [{ relation, entity, from, to }];
      });
      if (!created.length) return;
      state.commitBatch([
        ...created.map(({ node }) => ({ type: 'node_type.create' as const, entity: node })),
        ...newRelations.map(({ entity }) => ({ type: 'relation_type.create' as const, entity })),
      ], (current) => ({ ...current, nodes: [...current.nodes, ...created.map(({ node }) => node)], relations: [...current.relations, ...newRelations.map(({ entity }) => entity)] }));
      await waitForGraphSave();
      const fieldKey = (item: { concept: EditableConcept }, column: string) => item.concept.fields.find((field) => field.column === column)?.key ?? '';
      for (const item of created) {
        const result = await semanticModelApi.createSourceMapping(modelId, {
          conceptId: item.node.id, workspaceId: source.workspaceId, documentId: source.documentId, sheetName: item.concept.sheet,
          assetKind: source.assetKind,
          fieldMappings: item.concept.fields.filter((field) => !item.concept.excluded.includes(field.column)).map((field) => ({ sourceField: field.column, targetAttribute: field.key, mode: 'direct' as const })),
          identityFields: item.concept.keyColumn && !item.concept.excluded.includes(item.concept.keyColumn) ? [fieldKey(item, item.concept.keyColumn)] : [],
        });
        useSemanticModelEditorStore.getState().adoptRevision(result.revision);
      }
      for (const { relation, entity, from, to } of newRelations) {
        const result = await semanticModelApi.saveRelationResolutionRule(modelId, {
          relationId: entity.id, sourceAttribute: fieldKey(from, relation.fromColumn), targetAttribute: fieldKey(to, to.concept.keyColumn!),
          strategy: 'normalized', ambiguityPolicy: 'review',
        });
        useSemanticModelEditorStore.getState().adoptRevision(result.revision);
      }
      await client.invalidateQueries({ queryKey: semanticModelQueryKeys.all });
      showSuccess(t('suggest.applied', { count: created.length }));
      onOpenChange(false);
    } catch (error) {
      showError(t('suggest.applyError'), { description: parseApiError(error).message });
    } finally {
      setApplying(false);
    }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!applying) onOpenChange(next); }}>
    <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
      <DialogHeader>
        <DialogTitle className='flex items-center gap-2'><Sparkles className='h-5 w-5 text-primary' />{t('suggest.title')}</DialogTitle>
        <DialogDescription>{t('suggest.description')}</DialogDescription>
      </DialogHeader>
      {!initialSource && <div className='space-y-2'>
        <Label>{t('suggest.chooseFile')}</Label>
        {assets.isLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : spreadsheets.length === 0
          ? <p className='rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground'>{t('suggest.noFiles')}</p>
          : <Select value={source?.documentId ?? ''} onValueChange={(documentId) => {
            const asset = spreadsheets.find((item) => item.documentId === documentId);
            if (asset) setSource({ workspaceId: asset.workspaceId, documentId: asset.documentId, documentName: asset.name, assetKind: asset.kind as SuggestionSource['assetKind'] });
          }}>
            <SelectTrigger aria-label={t('suggest.chooseFile')}><SelectValue placeholder={t('suggest.chooseFilePlaceholder')} /></SelectTrigger>
            <SelectContent>{spreadsheets.map((asset) => <SelectItem key={asset.documentId} value={asset.documentId}>{asset.name}</SelectItem>)}</SelectContent>
          </Select>}
      </div>}
      {source && samples.isLoading && <p className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' />{t('suggest.loading', { name: source.documentName })}</p>}
      {source && samples.isError && <p className='flex gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive'><AlertTriangle className='h-4 w-4 shrink-0' />{t('suggest.error')}</p>}
      {samples.data && concepts.length === 0 && <p className='rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground'>{t('suggest.empty')}</p>}
      {concepts.length > 0 && <div className='space-y-3'>
        {concepts.map((concept) => <section key={concept.sheet} className={`space-y-3 rounded-xl border p-3 ${concept.include ? '' : 'opacity-60'}`}>
          <div className='flex flex-wrap items-center gap-2'>
            <input type='checkbox' checked={concept.include} onChange={(event) => editConcept(concept.sheet, { include: event.target.checked })} aria-label={t('suggest.includeConcept', { sheet: concept.sheet })} />
            <Input className='h-9 max-w-xs flex-1' value={concept.label} disabled={!concept.include} onChange={(event) => editConcept(concept.sheet, { label: event.target.value })} aria-label={t('suggest.rename', { sheet: concept.sheet })} />
            <span className='text-xs text-muted-foreground'>{t('suggest.fromSheet', { sheet: concept.sheet })}</span>
          </div>
          {concept.include && <>
            <div className='flex flex-wrap gap-1.5'>{concept.fields.map((field) => {
              const excluded = concept.excluded.includes(field.column);
              return <button key={field.column} type='button' aria-pressed={!excluded}
                onClick={() => editConcept(concept.sheet, { excluded: excluded ? concept.excluded.filter((column) => column !== field.column) : [...concept.excluded, field.column] })}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${excluded ? 'text-muted-foreground line-through' : 'bg-muted/60'}`}>
                {field.column === concept.keyColumn && <KeyRound className='h-3 w-3 text-amber-600' />}{field.label}<span className='text-muted-foreground'>· {t(`attribute.type.${field.type}`)}</span>
              </button>;
            })}</div>
            <div className='flex flex-wrap items-center gap-2 text-sm'>
              <span>{t('identity.title', { name: concept.label || concept.sheet })}</span>
              <Select value={concept.keyColumn ?? '__none'} onValueChange={(value) => editConcept(concept.sheet, { keyColumn: value === '__none' ? null : value })}>
                <SelectTrigger className='h-8 w-48' aria-label={t('identity.title', { name: concept.label || concept.sheet })}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value='__none'>{t('suggest.noKey')}</SelectItem>{concept.fields.map((field) => <SelectItem key={field.column} value={field.column}>{field.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </>}
        </section>)}
        {relations.length > 0 && <section className='space-y-2'>
          <h3 className='text-sm font-semibold'>{t('suggest.relations')}</h3>
          {relations.map((relation, index) => {
            const from = bySheet.get(relation.fromSheet);
            const to = bySheet.get(relation.toSheet);
            const usable = usableRelations.includes(relation);
            return <label key={`${relation.fromSheet}-${relation.fromColumn}-${relation.toSheet}`} className={`flex items-start gap-2 rounded-lg bg-muted/40 p-2 text-sm ${usable ? '' : 'opacity-60'}`}>
              <input type='checkbox' className='mt-1' checked={relation.include && usable} disabled={!usable} onChange={(event) => setRelations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, include: event.target.checked } : item))} />
              <span>{t('suggest.relationSentence', { from: from?.label ?? relation.fromSheet, to: to?.label ?? relation.toSheet, column: from?.fields.find((field) => field.column === relation.fromColumn)?.label ?? relation.fromColumn })}</span>
            </label>;
          })}
        </section>}
      </div>}
      <DialogFooter>
        <Button variant='outline' disabled={applying} onClick={() => onOpenChange(false)}>{t('action.cancel')}</Button>
        <Button disabled={applying || !concepts.some((concept) => concept.include && concept.label.trim())} onClick={() => void apply()}>
          {applying && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{t('suggest.apply')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
