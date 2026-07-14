import type { KnowledgeHealthSummary as Summary } from '../../types';
import { useModuleTranslation } from '@/modules/localization';
import { HealthDimensionBreakdown } from './HealthDimensionBreakdown';

export function KnowledgeHealthSummary({ summary }: Readonly<{ summary: Summary }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return <section className='grid gap-3' aria-labelledby='knowledge-health-title'><div className='grid gap-2 sm:grid-cols-4'><div className='rounded-xl border p-3'><h3 id='knowledge-health-title' className='text-xs text-muted-foreground'>{t('knowledge.health.average')}</h3><p className='mt-1 text-2xl font-semibold'>{summary.averageHealthScore}</p></div><div className='rounded-xl border p-3'><p className='text-xs text-muted-foreground'>{t('knowledge.health.healthy')}</p><p className='mt-1 text-2xl font-semibold'>{summary.byStatus.healthy}</p></div><div className='rounded-xl border p-3'><p className='text-xs text-muted-foreground'>{t('knowledge.health.warning')}</p><p className='mt-1 text-2xl font-semibold'>{summary.byStatus.warning}</p></div><div className='rounded-xl border p-3'><p className='text-xs text-muted-foreground'>{t('knowledge.health.critical')}</p><p className='mt-1 text-2xl font-semibold'>{summary.byStatus.critical}</p></div></div>{summary.assessments.map((assessment) => <HealthDimensionBreakdown key={assessment.id} assessment={assessment} />)}</section>;
}
