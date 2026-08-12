import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useModuleTranslation } from '@/modules/localization';
import { useAcknowledgeKnowledgeAlert, useApplyKnowledgeRecommendation, useDecideKnowledgeRecommendation, useDecideMetadataCandidate, useKnowledgeAlerts, useKnowledgeHealth, useKnowledgeRecommendations, useMetadataCandidates, useRefreshKnowledge } from '../../query/hooks';
import type { GovernanceDocument, KnowledgeAlert, KnowledgeAssessment, KnowledgeRecommendation } from '../../types';
import { HealthDimensionBreakdown } from './HealthDimensionBreakdown';
import { KnowledgeAlertCard } from './KnowledgeAlertCard';
import { KnowledgeRecommendationCard } from './KnowledgeRecommendationCard';
import { MetadataCandidateReview } from './MetadataCandidateReview';

type DocumentAction = { kind: 'alert'; alert: KnowledgeAlert } | { kind: 'recommendation'; recommendation: KnowledgeRecommendation };
type ConcernTag = 'businessValidity' | 'freshness' | 'availability' | 'integrity' | 'governanceQuality' | 'searchQuality' | 'impact';

const recommendationTag: Record<KnowledgeRecommendation['type'], ConcernTag> = {
  assign_owner: 'governanceQuality', schedule_review: 'freshness', confirm_validity: 'businessValidity', resolve_conflict: 'businessValidity', enrich_metadata: 'searchQuality', add_synonyms: 'searchQuality', merge_duplicate: 'integrity', reindex: 'searchQuality', change_scope: 'availability', exclude_from_runtime: 'availability',
};
const alertTag: Record<KnowledgeAlert['category'], ConcernTag> = { validity: 'businessValidity', freshness: 'freshness', availability: 'availability', integrity: 'integrity', governance: 'governanceQuality', search_quality: 'searchQuality', impact: 'impact' };

interface DocumentSection { document?: GovernanceDocument; documentId: string; label: string; assessment?: KnowledgeAssessment; actions: DocumentAction[]; tags: ConcernTag[] }
interface WorkspaceSection { workspaceId: string; label: string; documents: DocumentSection[]; score?: number; findings: number; tags: ConcernTag[] }

function buildWorkspaceSections(documents: GovernanceDocument[], assessments: KnowledgeAssessment[], actions: DocumentAction[], workspaceNames: Record<string, string>, labels: { other: string; scope: string; unknown: string }): WorkspaceSection[] {
  const documentById = new Map(documents.map((document) => [document.documentId, document]));
  const actionsByDocument = new Map<string, DocumentAction[]>();
  for (const action of actions) {
    const documentId = action.kind === 'alert' ? action.alert.documentId ?? 'scope' : action.recommendation.documentId ?? 'scope';
    actionsByDocument.set(documentId, [...(actionsByDocument.get(documentId) ?? []), action]);
  }
  const assessmentByDocument = new Map(assessments.map((assessment) => [assessment.documentId, assessment]));
  const documentIds = [...new Set([...documents.map((document) => document.documentId), ...assessments.map((assessment) => assessment.documentId), ...actionsByDocument.keys()])];
  const workspaceMap = new Map<string, WorkspaceSection>();
  for (const documentId of documentIds) {
    const document = documentById.get(documentId);
    const workspaceId = documentId === 'scope' ? 'scope' : document?.workspaceId ?? 'other';
    const workspaceLabel = workspaceId === 'scope' ? labels.scope : workspaceId === 'other' ? labels.other : workspaceNames[workspaceId] ?? labels.other;
    const documentActions = actionsByDocument.get(documentId) ?? [];
    const tags = [...new Set(documentActions.map((action) => action.kind === 'alert' ? alertTag[action.alert.category] : recommendationTag[action.recommendation.type]))];
    const section = workspaceMap.get(workspaceId) ?? { workspaceId, label: workspaceLabel, documents: [], findings: 0, tags: [] };
    section.documents.push({ document, documentId, label: documentId === 'scope' ? labels.scope : document?.document.originalName ?? labels.unknown, assessment: assessmentByDocument.get(documentId), actions: documentActions, tags });
    section.findings += documentActions.length;
    section.tags = [...new Set([...section.tags, ...tags])];
    workspaceMap.set(workspaceId, section);
  }
  return [...workspaceMap.values()].map((workspace) => {
    const scores = workspace.documents.map((document) => document.assessment?.overallHealthScore).filter((score): score is number => typeof score === 'number');
    return { ...workspace, score: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : undefined, documents: workspace.documents.sort((a, b) => a.label.localeCompare(b.label)) };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

export function KnowledgeActionCenter({ programId, scopeId, documents = [], workspaceNames = {}, onOpenDocument }: Readonly<{ programId: string | null; scopeId: string; documents?: GovernanceDocument[]; workspaceNames?: Record<string, string>; onOpenDocument: (documentId: string) => void }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const [filter, setFilter] = useState<'open' | 'completed' | 'all'>('open');
  const health = useKnowledgeHealth(programId, scopeId); const alerts = useKnowledgeAlerts(programId, scopeId); const recommendations = useKnowledgeRecommendations(programId, scopeId); const metadata = useMetadataCandidates(programId, scopeId);
  const refresh = useRefreshKnowledge(programId, scopeId); const acknowledge = useAcknowledgeKnowledgeAlert(programId, scopeId); const decideRecommendation = useDecideKnowledgeRecommendation(programId, scopeId); const applyRecommendation = useApplyKnowledgeRecommendation(programId, scopeId); const decideMetadata = useDecideMetadataCandidate(programId, scopeId);
  const isError = health.isError || alerts.isError || recommendations.isError || metadata.isError || refresh.isError || acknowledge.isError || decideRecommendation.isError || applyRecommendation.isError || decideMetadata.isError;
  const isLoading = health.isLoading || alerts.isLoading || recommendations.isLoading || metadata.isLoading;
  const allAlerts = alerts.data ?? []; const allRecommendations = recommendations.data ?? [];
  const openActions: DocumentAction[] = [...allAlerts.filter((item) => item.status === 'open').map((alert) => ({ kind: 'alert' as const, alert })), ...allRecommendations.filter((item) => item.status === 'proposed' || item.status === 'accepted').map((recommendation) => ({ kind: 'recommendation' as const, recommendation }))];
  const completedActions: DocumentAction[] = [...allAlerts.filter((item) => item.status !== 'open').map((alert) => ({ kind: 'alert' as const, alert })), ...allRecommendations.filter((item) => item.status !== 'proposed' && item.status !== 'accepted').map((recommendation) => ({ kind: 'recommendation' as const, recommendation }))];
  const labels = { other: t('knowledge.actionCenter.otherSources'), scope: t('knowledge.actionCenter.scopeWide'), unknown: t('knowledge.actionCenter.unknownSource') };
  const actionSet = filter === 'open' ? openActions : filter === 'completed' ? completedActions : [...openActions, ...completedActions];
  const workspaces = buildWorkspaceSections(documents, health.data?.assessments ?? [], actionSet, workspaceNames, labels);
  const latestAssessment = [...(health.data?.assessments ?? [])].sort((a, b) => b.assessedAt.localeCompare(a.assessedAt))[0];

  return <section className='grid gap-4 rounded-2xl border bg-muted/20 p-4' aria-labelledby='knowledge-action-center-title'>
    <div className='flex flex-wrap items-start justify-between gap-3'><div><h3 id='knowledge-action-center-title' className='font-semibold'>{t('knowledge.actionCenter.workspaceTitle')}</h3><p className='text-sm text-muted-foreground'>{t('knowledge.actionCenter.workspaceDescription')}</p></div><Button type='button' size='sm' variant='outline' disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? t('knowledge.refreshing') : t('knowledge.refresh')}</Button></div>
    {isError && <p role='alert' className='text-sm text-destructive'>{t('knowledge.error')}</p>}{isLoading && <p className='text-sm text-muted-foreground'>{t('knowledge.loading')}</p>}
    {health.data && <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-5'><Summary label={t('knowledge.health.average')} value={String(health.data.averageHealthScore)} /><Summary label={t('knowledge.health.healthy')} value={String(health.data.byStatus.healthy)} /><Summary label={t('knowledge.health.warning')} value={String(health.data.byStatus.warning)} /><Summary label={t('knowledge.health.critical')} value={String(health.data.byStatus.critical)} /><Summary label={t('knowledge.actionCenter.lastAssessment')} value={latestAssessment ? new Date(latestAssessment.assessedAt).toLocaleString() : t('scopeShell.overview.none')} /></div>}
    <div className='flex flex-wrap gap-2' role='group' aria-label={t('knowledge.actionCenter.filterLabel')}>{(['open', 'completed', 'all'] as const).map((value) => <Button key={value} type='button' size='sm' aria-pressed={filter === value} variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>{t(`knowledge.actionCenter.filter.${value}`)}</Button>)}</div>
    <div className='grid gap-2'>{workspaces.map((workspace) => <Collapsible key={workspace.workspaceId} className='rounded-xl border bg-background'><CollapsibleTrigger asChild><button type='button' className='flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'><span className='min-w-0'><span className='block truncate text-sm font-semibold'>{workspace.label}</span><span className='mt-1 block text-xs text-muted-foreground'>{t('knowledge.actionCenter.workspaceSummary', { sources: workspace.documents.length, score: workspace.score ?? '-', findings: workspace.findings })}</span><span className='mt-2 flex flex-wrap gap-1'>{workspace.tags.map((tag) => <span key={tag} className='rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'>{t(`knowledge.actionCenter.tag.${tag}`)}</span>)}</span></span><ChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' /></button></CollapsibleTrigger><CollapsibleContent className='grid gap-3 border-t p-3'>{workspace.documents.map((document) => <section key={document.documentId} className='rounded-xl border bg-muted/10 p-3'><div className='flex flex-wrap items-start justify-between gap-2'><div><h4 className='text-sm font-semibold'>{document.label}</h4><p className='text-xs text-muted-foreground'>{document.assessment ? t('knowledge.actionCenter.sourceHealth', { score: document.assessment.overallHealthScore, findings: document.actions.length, date: new Date(document.assessment.assessedAt).toLocaleString() }) : t('knowledge.actionCenter.sourceNotAssessed')}</p></div>{document.document && <Button type='button' size='sm' variant='outline' onClick={() => onOpenDocument(document.documentId)}>{t('knowledge.actionCenter.reviewSource')}</Button>}</div>{document.assessment && <div className='mt-3'><HealthDimensionBreakdown assessment={document.assessment} /></div>}<div className='mt-3 grid gap-2'>{document.actions.map((action) => action.kind === 'alert' ? <KnowledgeAlertCard key={`alert-${action.alert.id}`} alert={action.alert} sourceLabel={document.label} showSourceLabel={false} pending={acknowledge.isPending} onAcknowledge={() => acknowledge.mutate(action.alert.id)} onOpenSource={document.document ? () => onOpenDocument(document.documentId) : undefined} /> : <KnowledgeRecommendationCard key={`recommendation-${action.recommendation.id}`} recommendation={action.recommendation} sourceLabel={document.label} showSourceLabel={false} pending={decideRecommendation.isPending || applyRecommendation.isPending} onDecision={(actionValue) => decideRecommendation.mutate({ id: action.recommendation.id, action: actionValue })} onApply={() => applyRecommendation.mutate(action.recommendation.id)} onOpenSource={document.document ? () => onOpenDocument(document.documentId) : undefined} />)}{document.actions.length === 0 && <p className='text-sm text-muted-foreground'>{t('knowledge.actionCenter.noActions')}</p>}</div></section>)}</CollapsibleContent></Collapsible>)}</div>
    <Collapsible><CollapsibleTrigger asChild><Button type='button' variant='ghost' className='w-full justify-between'>{t('knowledge.actionCenter.advanced')}<ChevronDown className='h-4 w-4' /></Button></CollapsibleTrigger><CollapsibleContent className='grid gap-2 pt-2'>{(metadata.data ?? []).map((candidate) => <MetadataCandidateReview key={candidate.id} candidate={candidate} pending={decideMetadata.isPending} onDecision={(action) => decideMetadata.mutate({ id: candidate.id, action })} />)}{metadata.data?.length === 0 && <p className='text-sm text-muted-foreground'>{t('knowledge.metadata.empty')}</p>}</CollapsibleContent></Collapsible>
  </section>;
}

function Summary({ label, value }: Readonly<{ label: string; value: string }>): JSX.Element {
  return <div className='rounded-xl border bg-background p-3'><p className='text-xs text-muted-foreground'>{label}</p><p className='mt-1 text-lg font-semibold'>{value}</p></div>;
}
