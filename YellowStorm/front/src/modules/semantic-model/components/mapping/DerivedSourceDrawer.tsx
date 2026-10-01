import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GitMerge, KeyRound, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useDerivedSources, useIdentityRules } from '../../query/hooks';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSemanticModelEditorStore } from '../../store';
import type { AttributeDefinition, DerivedConflictRule, DerivedSource } from '../../types';

export interface DerivedSourceTarget {
  conceptId: string;
  /** The derived source to change; none to add one. */
  derived?: DerivedSource;
}

export const CONFLICT_RULES: DerivedConflictRule[] = ['most_frequent', 'latest', 'longest', 'leave_empty'];
const NOT_FILLED = '__none__';

const words = (text: string) => text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The source field most likely to fill a field: the same name, or a name that ends with it
 * ("customer_id" for "id", "customer name" for "name"). The shortest such name wins.
 */
export function suggestSourceField(field: Pick<AttributeDefinition, 'key' | 'label'>, sourceFields: Array<Pick<AttributeDefinition, 'key' | 'label'>>): string | undefined {
  const exact = sourceFields.find((candidate) => candidate.key === field.key);
  if (exact) return exact.key;
  const wanted = [words(field.key), words(field.label)].filter((list) => list.length);
  const matches = sourceFields.filter((candidate) => [words(candidate.key), words(candidate.label)].some((have) =>
    wanted.some((want) => want.length <= have.length && want.every((word, index) => have[have.length - want.length + index] === word))));
  return matches.sort((left, right) => left.key.length - right.key.length)[0]?.key;
}

/**
 * Fill a concept from another concept's records: one record per distinct key value they carry, e.g.
 * the organizations named by the customer id and name of every contract. The key fields are chosen
 * here, and so is what to keep when records sharing a key disagree.
 */
export function DerivedSourceDrawer({ modelId, target, onClose }: Readonly<{ modelId: string; target: DerivedSourceTarget | null; onClose: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const derivedSources = useDerivedSources(target ? modelId : undefined).data ?? [];
  const identityRules = useIdentityRules(target ? modelId : undefined).data ?? [];
  const concept = graph?.nodes.find((node) => node.id === target?.conceptId);
  const [sourceConceptId, setSourceConceptId] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<string[]>([]);
  const [rule, setRule] = useState<DerivedConflictRule>('most_frequent');
  const [orderBy, setOrderBy] = useState('');

  // A concept filled from another one cannot fill a third, so derivations never chain.
  const others = derivedSources.filter((source) => source.id !== target?.derived?.id);
  const candidates = useMemo(() => (graph?.nodes ?? []).filter((node) => !node.systemKey && node.id !== target?.conceptId
    && node.attributes.length > 0 && !others.some((other) => other.conceptId === node.id)), [graph?.nodes, others, target?.conceptId]);
  const fillsAnother = others.some((other) => other.sourceConceptId === target?.conceptId);
  const source = graph?.nodes.find((node) => node.id === sourceConceptId);

  const suggest = (sourceId: string) => {
    const from = graph?.nodes.find((node) => node.id === sourceId);
    return Object.fromEntries((concept?.attributes ?? []).map((field) => [field.key, from ? suggestSourceField(field, from.attributes) ?? '' : '']));
  };

  useEffect(() => {
    if (!target || !concept) return;
    const derived = target.derived;
    // A concept already linked to this one is the likeliest source: contracts name their customer.
    const linked = graph?.relations.flatMap((relation) => relation.sourceNodeTypeId === concept.id ? [relation.targetNodeTypeId]
      : relation.targetNodeTypeId === concept.id ? [relation.sourceNodeTypeId] : []) ?? [];
    const start = derived?.sourceConceptId ?? candidates.find((node) => linked.includes(node.id))?.id ?? candidates[0]?.id ?? '';
    setSourceConceptId(start);
    // A field removed from the source concept since saving is no longer offered, so it is not kept.
    const from = new Set(graph?.nodes.find((node) => node.id === start)?.attributes.map((field) => field.key));
    const mapped = derived
      ? Object.fromEntries(concept.attributes.map((field) => {
        const copied = derived.fieldMappings.find((item) => item.targetAttribute === field.key)?.sourceAttribute ?? '';
        return [field.key, from.has(copied) ? copied : ''];
      }))
      : suggest(start);
    setFields(mapped);
    const identity = identityRules.find((item) => item.conceptId === concept.id)?.fields ?? [];
    setKeys(identity.length ? identity : concept.attributes.filter((field) => mapped[field.key]).slice(0, 1).map((field) => field.key));
    setRule(derived?.conflictRule ?? 'most_frequent');
    setOrderBy(derived?.orderBy && from.has(derived.orderBy) ? derived.orderBy : '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.conceptId, target?.derived?.id, concept?.id, identityRules.length, candidates.length]);

  const mappedFields = (concept?.attributes ?? []).filter((field) => fields[field.key]);
  const unmappedKey = keys.find((key) => !fields[key]);
  const problem = !source ? t('derived.problem.source')
    : fillsAnother ? t('derived.problem.fillsAnother', { concept: concept?.label ?? '' })
    : !mappedFields.length ? t('derived.problem.noField')
    : !keys.length ? t('derived.problem.noKey')
    : unmappedKey ? t('derived.problem.keyNotFilled', { field: concept?.attributes.find((field) => field.key === unmappedKey)?.label ?? unmappedKey })
    : rule === 'latest' && !orderBy ? t('derived.problem.orderBy')
    : null;

  const refresh = async (revision: number) => {
    useSemanticModelEditorStore.getState().adoptRevision(revision);
    await Promise.all([
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.derivedSources(modelId) }),
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.identityRules(modelId) }),
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.reviewQueue(modelId) }),
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.freshness(modelId) }),
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
    ]);
  };
  const save = useMutation({
    mutationFn: () => semanticModelApi.saveDerivedSource(modelId, {
      conceptId: concept!.id,
      sourceConceptId,
      fieldMappings: mappedFields.map((field) => ({ sourceAttribute: fields[field.key], targetAttribute: field.key })),
      identityFields: keys,
      conflictRule: rule,
      ...(rule === 'latest' ? { orderBy } : {}),
    }, target?.derived?.id),
    onSuccess: async (result) => {
      await refresh(result.revision);
      showSuccess(t('derived.saved', { concept: concept?.label ?? '', source: source?.label ?? '' }));
      onClose();
    },
    onError: (error) => showError(t('derived.saveError'), { description: parseApiError(error).message }),
  });
  const remove = useMutation({
    mutationFn: () => semanticModelApi.deleteDerivedSource(modelId, target!.derived!.id),
    onSuccess: async (result) => { await refresh(result.revision); onClose(); },
    onError: (error) => showError(t('derived.removeError'), { description: parseApiError(error).message }),
  });

  const toggleKey = (key: string) => setKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const keyLabels = keys.map((key) => concept?.attributes.find((field) => field.key === key)?.label ?? key).join(', ');
  const busy = save.isPending || remove.isPending;

  return <Sheet modal={false} open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
    {target && concept && <SheetContent side='right' className='flex w-full flex-col gap-0 p-0 sm:max-w-xl' onInteractOutside={(event) => event.preventDefault()}>
      <SheetHeader className='border-b p-5'>
        <SheetTitle className='flex items-center gap-2'><GitMerge className='h-4 w-4' />{t('derived.title', { concept: concept.label })}</SheetTitle>
        <SheetDescription>{t('derived.description', { concept: concept.label })}</SheetDescription>
      </SheetHeader>
      <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-5'>
        <div className='space-y-2'>
          <Label>{t('derived.source')}</Label>
          <Select value={sourceConceptId} onValueChange={(value) => { setSourceConceptId(value); setFields(suggest(value)); setOrderBy(''); }}>
            <SelectTrigger aria-label={t('derived.source')}><SelectValue placeholder={t('derived.chooseSource')} /></SelectTrigger>
            <SelectContent>{candidates.map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}</SelectContent>
          </Select>
          {!candidates.length && <p className='text-xs text-muted-foreground'>{t('derived.noCandidate')}</p>}
        </div>

        {source && <div className='space-y-2'>
          <Label>{t('derived.fields')}</Label>
          <p className='text-xs text-muted-foreground'>{t('derived.fieldsHelp', { source: source.label })}</p>
          <div className='overflow-hidden rounded-xl border'>
            {concept.attributes.map((field) => {
              const isKey = keys.includes(field.key);
              return <div key={field.key} className='flex items-center gap-2 border-b p-2.5 last:border-b-0'>
                <span className='min-w-0 flex-1 truncate text-xs font-medium'>{field.label}</span>
                <Select value={fields[field.key] || NOT_FILLED} onValueChange={(value) => setFields((current) => ({ ...current, [field.key]: value === NOT_FILLED ? '' : value }))}>
                  <SelectTrigger className='h-8 w-44 text-xs' aria-label={t('derived.fieldFor', { field: field.label })}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_FILLED}>{t('derived.notFilled')}</SelectItem>
                    {source.attributes.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <button type='button' aria-pressed={isKey} aria-label={t('derived.keyFor', { field: field.label })} title={t('derived.key')}
                  className={cn('flex h-8 items-center gap-1 rounded-md border px-2 text-[11px]', isKey ? 'border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'text-muted-foreground hover:bg-muted')}
                  onClick={() => toggleKey(field.key)}>
                  <KeyRound className='h-3.5 w-3.5' />{t('derived.key')}
                </button>
              </div>;
            })}
          </div>
        </div>}

        {source && <div className='space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3'>
          <p className='flex items-center gap-1.5 text-xs font-medium'><KeyRound className='h-3.5 w-3.5' />
            {keys.length ? t('derived.keysSummary', { concept: concept.label, fields: keyLabels, source: source.label }) : t('derived.problem.noKey')}
          </p>
          <div className='space-y-1.5'>
            <Label htmlFor='derived-conflict' className='text-xs'>{t('derived.conflict')}</Label>
            <Select value={rule} onValueChange={(value: DerivedConflictRule) => setRule(value)}>
              <SelectTrigger id='derived-conflict' className='h-9 text-xs'><SelectValue /></SelectTrigger>
              <SelectContent>{CONFLICT_RULES.map((item) => <SelectItem key={item} value={item}>{t(`derived.rule.${item}`)}</SelectItem>)}</SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>{t(`derived.ruleHelp.${rule}`)}</p>
          </div>
          {rule === 'latest' && <div className='space-y-1.5'>
            <Label htmlFor='derived-order' className='text-xs'>{t('derived.orderBy', { source: source.label })}</Label>
            <Select value={orderBy} onValueChange={setOrderBy}>
              <SelectTrigger id='derived-order' className='h-9 text-xs'><SelectValue placeholder={t('derived.chooseOrderBy')} /></SelectTrigger>
              <SelectContent>{[...source.attributes].sort((left, right) => Number(right.type === 'date') - Number(left.type === 'date'))
                .map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>}
        </div>}

        {problem && source && <p role='alert' className='text-xs text-amber-700 dark:text-amber-400'>{problem}</p>}
        {fillsAnother && !source && <p role='alert' className='text-xs text-amber-700 dark:text-amber-400'>{problem}</p>}
      </div>
      <div className='flex items-center gap-2 border-t p-4'>
        {target.derived && <Button variant='ghost' className='text-destructive' disabled={busy} onClick={() => remove.mutate()}>
          <Trash2 className='mr-1.5 h-4 w-4' />{t('derived.remove')}
        </Button>}
        <div className='flex-1' />
        <Button variant='outline' onClick={onClose} disabled={busy}>{t('action.cancel')}</Button>
        <Button onClick={() => save.mutate()} disabled={Boolean(problem) || busy}>{save.isPending ? t('derived.saving') : t('derived.save')}</Button>
      </div>
    </SheetContent>}
  </Sheet>;
}
