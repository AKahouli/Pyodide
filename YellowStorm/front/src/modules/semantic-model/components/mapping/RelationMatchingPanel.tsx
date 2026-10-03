import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useRelationResolutionRules } from '../../query/hooks';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSemanticModelEditorStore } from '../../store';
import type { RelationMatchStrategy, SemanticRelationType } from '../../types';
import { FormField, INPUT, ROW_LIST } from '../form/FormParts';

export function RelationMatchingPanel({ modelId, relation }: Readonly<{ modelId: string; relation: SemanticRelationType }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const rules = useRelationResolutionRules(modelId);
  const existing = rules.data?.find((rule) => rule.relationId === relation.id);
  const source = graph?.nodes.find((node) => node.id === relation.sourceNodeTypeId);
  const target = graph?.nodes.find((node) => node.id === relation.targetNodeTypeId);
  const [sourceAttribute, setSourceAttribute] = useState('');
  const [targetAttribute, setTargetAttribute] = useState('');
  const [strategy, setStrategy] = useState<RelationMatchStrategy>('exact');
  const [ambiguityPolicy, setAmbiguityPolicy] = useState<'review' | 'unresolved'>('review');
  const [ruleId, setRuleId] = useState<string | null>(null);

  useEffect(() => {
    setSourceAttribute(existing?.sourceAttribute ?? source?.attributes[0]?.key ?? '');
    setTargetAttribute(existing?.targetAttribute ?? target?.attributes[0]?.key ?? '');
    setStrategy(existing?.strategy ?? 'exact');
    setAmbiguityPolicy(existing?.ambiguityPolicy ?? 'review');
    setRuleId(existing?.id ?? null);
  }, [existing?.id, relation.id, source?.id, target?.id]);

  const save = useMutation({
    mutationFn: () => semanticModelApi.saveRelationResolutionRule(modelId, {
      relationId: relation.id,
      sourceAttribute,
      targetAttribute,
      strategy,
      ambiguityPolicy,
    }),
    onSuccess: async (result) => {
      setRuleId(result.id);
      useSemanticModelEditorStore.getState().adoptRevision(result.revision);
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.relationRules(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
        client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] }),
      ]);
      showSuccess(t('relationMatching.saved'));
    },
    onError: (error) => showError(t('relationMatching.saveError'), { description: error instanceof Error ? error.message : undefined }),
  });
  const preview = useMutation({
    mutationFn: () => semanticModelApi.previewRelationResolutionRule(modelId, ruleId!, 25),
    onError: (error) => showError(t('relationMatching.previewError'), { description: error instanceof Error ? error.message : undefined }),
  });
  const canSave = Boolean(sourceAttribute && targetAttribute) && !save.isPending;

  const idPrefix = `relation-matching-${relation.id}`;

  return <div className='space-y-4'>
    <p className='rounded-lg bg-muted/40 px-3 py-2 text-sm'>
      {sourceAttribute && targetAttribute
        ? t('relationSentence.matchSentence', {
          source: source?.label ?? '', sourceField: source?.attributes.find((attribute) => attribute.key === sourceAttribute)?.label ?? sourceAttribute,
          target: target?.label ?? '', targetField: target?.attributes.find((attribute) => attribute.key === targetAttribute)?.label ?? targetAttribute,
        })
        : t('relationSentence.chooseBoth')}
    </p>
    <FormField label={source?.label}>
      <Select value={sourceAttribute} onValueChange={setSourceAttribute}>
        <SelectTrigger className={INPUT} aria-label={t('relationMatching.sourceField')}><SelectValue placeholder={t('relationMatching.chooseField')} /></SelectTrigger>
        <SelectContent>{source?.attributes.map((attribute) => <SelectItem key={attribute.key} value={attribute.key}>{attribute.label}</SelectItem>)}</SelectContent>
      </Select>
    </FormField>
    <FormField label={target?.label}>
      <Select value={targetAttribute} onValueChange={setTargetAttribute}>
        <SelectTrigger className={INPUT} aria-label={t('relationMatching.targetField')}><SelectValue placeholder={t('relationMatching.chooseField')} /></SelectTrigger>
        <SelectContent>{target?.attributes.map((attribute) => <SelectItem key={attribute.key} value={attribute.key}>{attribute.label}</SelectItem>)}</SelectContent>
      </Select>
    </FormField>
    <FormField label={t('relationMatching.strategy')} htmlFor={`${idPrefix}-strategy`}>
      <Select value={strategy} onValueChange={(value: RelationMatchStrategy) => setStrategy(value)}>
        <SelectTrigger id={`${idPrefix}-strategy`} className={INPUT}><SelectValue /></SelectTrigger>
        <SelectContent>{(['exact', 'case_insensitive', 'normalized'] as const).map((value) => <SelectItem key={value} value={value}>{t(`relationMatching.strategyOption.${value}`)}</SelectItem>)}</SelectContent>
      </Select>
    </FormField>
    <FormField label={t('relationMatching.ambiguity')} htmlFor={`${idPrefix}-ambiguity`}>
      <Select value={ambiguityPolicy} onValueChange={(value: 'review' | 'unresolved') => setAmbiguityPolicy(value)}>
        <SelectTrigger id={`${idPrefix}-ambiguity`} className={INPUT}><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value='review'>{t('relationMatching.review')}</SelectItem><SelectItem value='unresolved'>{t('relationMatching.leaveUnresolved')}</SelectItem></SelectContent>
      </Select>
    </FormField>
    <div className='flex gap-2 pt-1'>
      <Button size='sm' className='h-9 flex-1' disabled={!canSave} onClick={() => save.mutate()}>{save.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{t('relationMatching.save')}</Button>
      <Button size='sm' className='h-9 flex-1' variant='outline' disabled={!ruleId || preview.isPending} onClick={() => preview.mutate()}>{preview.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{t('relationMatching.preview')}</Button>
    </div>
    {preview.data && <div className='space-y-3'>
      <div className='grid grid-cols-3 gap-2 text-center text-xs'>
        <Metric value={preview.data.summary.resolved} label={t('relationMatching.resolved')} good />
        <Metric value={preview.data.summary.ambiguous} label={t('relationMatching.ambiguous')} />
        <Metric value={preview.data.summary.unresolved} label={t('relationMatching.unresolved')} />
      </div>
      {preview.data.sourceIssues.map((issue) => <p key={`${issue.mappingId}-${issue.message}`} className='flex gap-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'><AlertTriangle className='h-4 w-4 shrink-0' />{issue.message}</p>)}
      {preview.data.matches.length > 0 && <ul className={ROW_LIST}>{preview.data.matches.slice(0, 10).map((match) => <li key={match.sourceEntityId} className='flex items-start gap-2 px-3 py-2 text-xs'>
        {match.status === 'resolved' ? <CheckCircle2 className='mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600' aria-hidden /> : <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600' aria-hidden />}
        <div className='min-w-0 flex-1'>
          <p className='truncate font-medium' title={match.sourceLabel}>{match.sourceLabel}</p>
          {match.targetLabels.length > 0 && <p className='truncate text-muted-foreground' title={match.targetLabels.join(', ')}>{match.targetLabels.join(', ')}</p>}
        </div>
        <span className={match.status === 'resolved' ? 'shrink-0 text-emerald-600' : 'shrink-0 text-amber-600'}>{t(`relationMatching.status.${match.status}`)}</span>
      </li>)}</ul>}
    </div>}
  </div>;
}

function Metric({ value, label, good = false }: Readonly<{ value: number; label: string; good?: boolean }>) {
  return <div className={`rounded-lg p-2 ${good ? 'bg-emerald-500/10' : 'bg-muted/60'}`}><p className='text-base font-semibold'>{value}</p><p className='text-muted-foreground'>{label}</p></div>;
}
