import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { KnowledgeAlert } from '../../types';

export function KnowledgeAlertCard({ alert, sourceLabel, showSourceLabel = true, pending, onAcknowledge, onOpenSource }: Readonly<{ alert: KnowledgeAlert; sourceLabel: string; showSourceLabel?: boolean; pending: boolean; onAcknowledge: () => void; onOpenSource?: () => void }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return <article className='grid gap-2 rounded-xl border p-3'><div className='flex flex-wrap items-center justify-between gap-2'><div>{showSourceLabel && <p className='text-xs font-medium text-primary'>{sourceLabel}</p>}<h4 className='text-sm font-medium'>{alert.title}</h4></div><span className='rounded-full bg-muted px-2 py-1 text-xs'>{t(`knowledge.priority.${alert.severity}`)} · {t(`knowledge.alert.status.${alert.status}`)}</span></div><p className='text-sm text-muted-foreground'>{alert.description}</p><div className='flex flex-wrap gap-2'>{alert.status === 'open' && <Button type='button' size='sm' variant='outline' disabled={pending} onClick={onAcknowledge}>{t('knowledge.alert.acknowledge')}</Button>}{onOpenSource && <Button type='button' size='sm' variant='ghost' onClick={onOpenSource}>{t('knowledge.openSource')}</Button>}</div></article>;
}
