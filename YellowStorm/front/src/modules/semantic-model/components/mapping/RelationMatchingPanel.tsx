import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useRelationResolutionRules } from '../../query/hooks';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSemanticModelEditorStore } from '../../store';
import type { RelationMatchStrategy, SemanticRelationType } from '../../types';

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

  return <div className='space-y-4'>
    <p className='rounded-xl bg-primary/5 p-3 text-xs text-muted-foreground'>
      {t('relationMatching.question', { source: source?.label ?? '', target: target?.label ?? '' })}
    </p>
    <div className='space-y-2'>
      <Label>{source?.label}</Label>
      <Select value={sourceAttribute} onValueChange={setSourceAttribute}>
        <SelectTrigger aria-label={t('relationMatching.sourceField')}><SelectValue placeholder={t('relationMatching.chooseField')} /></SelectTrigger>
        <SelectContent>{source?.attributes.map((attribute) => <SelectItem key={attribute.key} value={attribute.key}>{attribute.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className='space-y-2'>
      <Label>{target?.label}</Label>
      <Select value={targetAttribute} onValueChange={setTargetAttribute}>
        <SelectTrigger aria-label={t('relationMatching.targetField')}><SelectValue placeholder={t('relationMatching.chooseField')} /></SelectTrigger>
        <SelectContent>{target?.attributes.map((attribute) => <SelectItem key={attribute.key} value={attribute.key}>{attribute.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className='space-y-2'>
      <Label>{t('relationMatching.strategy')}</Label>
      <Select value={strategy} onValueChange={(value: RelationMatchStrategy) => setStrategy(value)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{(['exact', 'case_insensitive', 'normalized'] as const).map((value) => <SelectItem key={value} value={value}>{t(`relationMatching.strategyOption.${value}`)}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className='space-y-2'>
      <Label>{t('relationMatching.ambiguity')}</Label>
      <Select value={ambiguityPolicy} onValueChange={(value: 'review' | 'unresolved') => setAmbiguityPolicy(value)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value='review'>{t('relationMatching.review')}</SelectItem><SelectItem value='unresolved'>{t('relationMatching.leaveUnresolved')}</SelectItem></SelectContent>
      </Select>
    </div>
    <div className='flex gap-2'>
      <Button className='flex-1' disabled={!canSave} onClick={() => save.mutate()}>{save.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{t('relationMatching.save')}</Button>
      <Button className='flex-1' variant='outline' disabled={!ruleId || preview.isPending} onClick={() => preview.mutate()}>{preview.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{t('relationMatching.preview')}</Button>
    </div>
    {preview.data && <div className='space-y-2'>
      <div className='grid grid-cols-3 gap-2 text-center text-xs'>
        <Metric value={preview.data.summary.resolved} label={t('relationMatching.resolved')} good />
        <Metric value={preview.data.summary.ambiguous} label={t('relationMatching.ambiguous')} />
        <Metric value={preview.data.summary.unresolved} label={t('relationMatching.unresolved')} />
      </div>
      {preview.data.sourceIssues.map((issue) => <p key={`${issue.mappingId}-${issue.message}`} className='flex gap-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'><AlertTriangle className='h-4 w-4 shrink-0' />{issue.message}</p>)}
      {preview.data.matches.slice(0, 10).map((match) => <div key={match.sourceEntityId} className='rounded-xl border p-3 text-xs'>
        <p className='font-medium'>{match.sourceLabel}</p>
        <p className={match.status === 'resolved' ? 'text-emerald-600' : 'text-amber-600'}>{match.status === 'resolved' ? <CheckCircle2 className='mr-1 inline h-3.5 w-3.5' /> : <AlertTriangle className='mr-1 inline h-3.5 w-3.5' />}{t(`relationMatching.status.${match.status}`)}</p>
        {match.targetLabels.length > 0 && <p className='text-muted-foreground'>{match.targetLabels.join(', ')}</p>}
      </div>)}
    </div>}
  </div>;
}

function Metric({ value, label, good = false }: Readonly<{ value: number; label: string; good?: boolean }>) {
  return <div className={`rounded-lg p-2 ${good ? 'bg-emerald-500/10' : 'bg-muted'}`}><p className='text-base font-semibold'>{value}</p><p className='text-muted-foreground'>{label}</p></div>;
}
