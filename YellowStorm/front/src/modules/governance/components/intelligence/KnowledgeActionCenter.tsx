import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useModuleTranslation } from '@/modules/localization';
import { useAcknowledgeKnowledgeAlert, useApplyKnowledgeRecommendation, useDecideKnowledgeRecommendation, useDecideMetadataCandidate, useKnowledgeAlerts, useKnowledgeHealth, useKnowledgeRecommendations, useMetadataCandidates, useRefreshKnowledge } from '../../query/hooks';
import type { KnowledgeAlert, KnowledgeRecommendation } from '../../types';
import { KnowledgeHealthSummary } from './KnowledgeHealthSummary';
import { KnowledgeAlertCard } from './KnowledgeAlertCard';
import { KnowledgeRecommendationCard } from './KnowledgeRecommendationCard';
import { MetadataCandidateReview } from './MetadataCandidateReview';

type SourceAction = { kind: 'alert'; alert: KnowledgeAlert } | { kind: 'recommendation'; recommendation: KnowledgeRecommendation };
type ConcernTag = 'businessValidity' | 'freshness' | 'availability' | 'integrity' | 'governanceQuality' | 'searchQuality' | 'impact';
interface SourceActionGroup { sourceId?: string; sourceKey: string; label: string; tags: ConcernTag[]; actions: SourceAction[]; }

const recommendationTag: Record<KnowledgeRecommendation['type'], ConcernTag> = {
  assign_owner: 'governanceQuality', schedule_review: 'freshness', confirm_validity: 'businessValidity', resolve_conflict: 'businessValidity', enrich_metadata: 'searchQuality', add_synonyms: 'searchQuality', merge_duplicate: 'integrity', reindex: 'searchQuality', change_scope: 'availability', exclude_from_runtime: 'availability',
};
const alertTag: Record<KnowledgeAlert['category'], ConcernTag> = { validity: 'businessValidity', freshness: 'freshness', availability: 'availability', integrity: 'integrity', governance: 'governanceQuality', search_quality: 'searchQuality', impact: 'impact' };

function groupBySource(actions: SourceAction[], sourceNames: Record<string, string>, scopeLabel: string, unknownLabel: string): SourceActionGroup[] {
  const groups = new Map<string, SourceActionGroup>();
  for (const action of actions) {
    const sourceId = action.kind === 'alert' ? action.alert.sourceId : action.recommendation.sourceId;
    const sourceKey = sourceId ?? 'scope';
    const tag = action.kind === 'alert' ? alertTag[action.alert.category] : recommendationTag[action.recommendation.type];
    const group = groups.get(sourceKey) ?? { sourceId, sourceKey, label: sourceId ? sourceNames[sourceId] ?? unknownLabel : scopeLabel, tags: [], actions: [] };
    if (!group.tags.includes(tag)) group.tags.push(tag);
    group.actions.push(action); groups.set(sourceKey, group);
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function KnowledgeActionCenter({ programId, scopeId, sourceNames = {}, onOpenSource }: Readonly<{ programId: string | null; scopeId: string; sourceNames?: Record<string, string>; onOpenSource: (sourceId: string) => void }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const [filter, setFilter] = useState<'open' | 'completed' | 'all'>('open');
  const health = useKnowledgeHealth(programId, scopeId); const alerts = useKnowledgeAlerts(programId, scopeId); const recommendations = useKnowledgeRecommendations(programId, scopeId); const metadata = useMetadataCandidates(programId, scopeId);
  const refresh = useRefreshKnowledge(programId, scopeId); const acknowledge = useAcknowledgeKnowledgeAlert(programId, scopeId); const decideRecommendation = useDecideKnowledgeRecommendation(programId, scopeId); const applyRecommendation = useApplyKnowledgeRecommendation(programId, scopeId); const decideMetadata = useDecideMetadataCandidate(programId, scopeId);
  const isError = health.isError || alerts.isError || recommendations.isError || metadata.isError || refresh.isError || acknowledge.isError || decideRecommendation.isError || applyRecommendation.isError || decideMetadata.isError;
  const isLoading = health.isLoading || alerts.isLoading || recommendations.isLoading || metadata.isLoading;
  const allAlerts = alerts.data ?? [];
  const allRecommendations = recommendations.data ?? [];
  const openActions: SourceAction[] = [...allAlerts.filter((item) => item.status === 'open').map((alert) => ({ kind: 'alert' as const, alert })), ...allRecommendations.filter((item) => item.status === 'proposed' || item.status === 'accepted').map((recommendation) => ({ kind: 'recommendation' as const, recommendation }))];
  const completedActions: SourceAction[] = [...allAlerts.filter((item) => item.status !== 'open').map((alert) => ({ kind: 'alert' as const, alert })), ...allRecommendations.filter((item) => item.status !== 'proposed' && item.status !== 'accepted').map((recommendation) => ({ kind: 'recommendation' as const, recommendation }))];
  const labels = { scope: t('knowledge.actionCenter.scopeWide'), unknown: t('knowledge.actionCenter.unknownSource') };
  const openGroups = groupBySource(openActions, sourceNames, labels.scope, labels.unknown); const completedGroups = groupBySource(completedActions, sourceNames, labels.scope, labels.unknown); const allGroups = groupBySource([...openActions, ...completedActions], sourceNames, labels.scope, labels.unknown);
  const visibleGroups = filter === 'open' ? openGroups : filter === 'completed' ? completedGroups : allGroups;
  return <section className='grid gap-4 rounded-2xl border bg-muted/20 p-4' aria-labelledby='knowledge-action-center-title'>
    <div className='flex flex-wrap items-start justify-between gap-3'><div><h3 id='knowledge-action-center-title' className='font-semibold'>{t('knowledge.actionCenter.title')}</h3><p className='text-sm text-muted-foreground'>{t('knowledge.actionCenter.groupedDescription')}</p></div><Button type='button' size='sm' variant='outline' disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? t('knowledge.refreshing') : t('knowledge.refresh')}</Button></div>
    {isError && <p role='alert' className='text-sm text-destructive'>{t('knowledge.error')}</p>}{isLoading && <p className='text-sm text-muted-foreground'>{t('knowledge.loading')}</p>}{health.data && <KnowledgeHealthSummary summary={health.data} />}
    <div className='flex flex-wrap gap-2' role='group' aria-label={t('knowledge.actionCenter.filterLabel')}>{([['open', openGroups.length], ['completed', completedGroups.length], ['all', allGroups.length]] as const).map(([value, count]) => <Button key={value} type='button' size='sm' aria-pressed={filter === value} variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>{t(`knowledge.actionCenter.filter.${value}`)} ({count})</Button>)}</div>
    <section className='grid gap-2' aria-label={t('knowledge.actionCenter.title')}>{visibleGroups.map((group) => <Collapsible key={group.sourceKey} className='rounded-xl border bg-background'><CollapsibleTrigger asChild><button type='button' className='flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'><span className='min-w-0'><span className='block truncate text-sm font-semibold'>{group.label}</span><span className='mt-1 flex flex-wrap gap-1'>{group.tags.map((tag) => <span key={tag} className='rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'>{t(`knowledge.actionCenter.tag.${tag}`)}</span>)}</span></span><span className='flex shrink-0 items-center gap-2 text-xs text-muted-foreground'>{t('knowledge.actionCenter.findingCount', { count: group.actions.length })}<ChevronDown className='h-4 w-4' /></span></button></CollapsibleTrigger><CollapsibleContent className='grid gap-2 border-t p-3'>{group.sourceId && sourceNames[group.sourceId] && <Button type='button' size='sm' variant='ghost' className='w-fit' onClick={() => onOpenSource(group.sourceId!)}>{t('knowledge.openSource')}</Button>}{group.actions.map((action) => action.kind === 'alert' ? <KnowledgeAlertCard key={`alert-${action.alert.id}`} alert={action.alert} sourceLabel={group.label} showSourceLabel={false} pending={acknowledge.isPending} onAcknowledge={() => acknowledge.mutate(action.alert.id)} /> : <KnowledgeRecommendationCard key={`recommendation-${action.recommendation.id}`} recommendation={action.recommendation} sourceLabel={group.label} showSourceLabel={false} pending={decideRecommendation.isPending || applyRecommendation.isPending} onDecision={(decision) => decideRecommendation.mutate({ id: action.recommendation.id, action: decision })} onApply={() => applyRecommendation.mutate(action.recommendation.id)} />)}</CollapsibleContent></Collapsible>)}{visibleGroups.length === 0 && <p className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('knowledge.actionCenter.empty')}</p>}</section>
    <Collapsible><CollapsibleTrigger asChild><Button type='button' variant='ghost' className='w-full justify-between'>{t('knowledge.actionCenter.advanced')}<ChevronDown className='h-4 w-4' /></Button></CollapsibleTrigger><CollapsibleContent className='grid gap-2 pt-2'>{(metadata.data ?? []).map((candidate) => <MetadataCandidateReview key={candidate.id} candidate={candidate} pending={decideMetadata.isPending} onDecision={(action) => decideMetadata.mutate({ id: candidate.id, action })} />)}{metadata.data?.length === 0 && <p className='text-sm text-muted-foreground'>{t('knowledge.metadata.empty')}</p>}</CollapsibleContent></Collapsible>
  </section>;
}
