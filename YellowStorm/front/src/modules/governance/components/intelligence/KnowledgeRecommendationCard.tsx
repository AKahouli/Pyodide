import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { KnowledgeRecommendation } from '../../types';

const automaticallyApplicable = new Set<KnowledgeRecommendation['type']>(['schedule_review', 'reindex']);

export function KnowledgeRecommendationCard({ recommendation, pending, onDecision, onApply, onOpenSource }: Readonly<{ recommendation: KnowledgeRecommendation; pending: boolean; onDecision: (action: 'accept' | 'reject') => void; onApply: () => void; onOpenSource?: () => void }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return <article className='grid gap-2 rounded-xl border p-3'><div className='flex flex-wrap items-center justify-between gap-2'><h4 className='text-sm font-medium'>{t(`knowledge.recommendation.type.${recommendation.type}`)}</h4><span className='rounded-full bg-muted px-2 py-1 text-xs'>{t(`knowledge.priority.${recommendation.priority}`)} · {t(`knowledge.recommendation.status.${recommendation.status}`)}</span></div><p className='text-sm'>{recommendation.reason}</p><p className='text-xs text-muted-foreground'>{recommendation.impactSummary}</p><div className='flex flex-wrap gap-2'>{recommendation.status === 'proposed' && <><Button type='button' size='sm' disabled={pending} onClick={() => onDecision('accept')}>{t('knowledge.recommendation.accept')}</Button><Button type='button' size='sm' variant='outline' disabled={pending} onClick={() => onDecision('reject')}>{t('knowledge.recommendation.reject')}</Button></>}{recommendation.status === 'accepted' && automaticallyApplicable.has(recommendation.type) && <Button type='button' size='sm' disabled={pending} onClick={onApply}>{t('knowledge.recommendation.apply')}</Button>}{onOpenSource && <Button type='button' size='sm' variant='ghost' onClick={onOpenSource}>{t('knowledge.openSource')}</Button>}</div></article>;
}
