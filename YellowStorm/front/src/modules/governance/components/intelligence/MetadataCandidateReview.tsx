import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { GovernanceMetadataCandidate } from '../../types';

export function MetadataCandidateReview({ candidate, pending, onDecision }: Readonly<{ candidate: GovernanceMetadataCandidate; pending: boolean; onDecision: (action: 'accept' | 'reject') => void }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return <article className='grid gap-2 rounded-xl border p-3'><div className='flex flex-wrap items-center justify-between gap-2'><h4 className='text-sm font-medium'>{candidate.key}</h4><span className='rounded-full bg-muted px-2 py-1 text-xs'>{Math.round(candidate.confidence * 100)}% · {t(`knowledge.metadata.status.${candidate.status}`)}</span></div><p className='break-words text-sm text-muted-foreground'>{String(candidate.proposedValue)}</p>{candidate.status === 'proposed' && <div className='flex gap-2'><Button type='button' size='sm' disabled={pending} onClick={() => onDecision('accept')}>{t('knowledge.metadata.accept')}</Button><Button type='button' size='sm' variant='outline' disabled={pending} onClick={() => onDecision('reject')}>{t('knowledge.metadata.reject')}</Button></div>}</article>;
}
