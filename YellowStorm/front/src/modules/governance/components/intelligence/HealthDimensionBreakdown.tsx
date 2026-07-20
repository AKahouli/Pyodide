import { useModuleTranslation } from '@/modules/localization';
import type { KnowledgeAssessment } from '../../types';

const dimensionKeys = ['businessValidity', 'freshness', 'availability', 'integrity', 'searchQuality', 'governanceQuality'] as const;

export function HealthDimensionBreakdown({ assessment }: Readonly<{ assessment: KnowledgeAssessment }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return (
    <details className='rounded-lg border p-3'>
      <summary className='cursor-pointer text-sm font-medium'>{t('knowledge.assessment.details')}</summary>
      <div className='mt-3 grid gap-2 sm:grid-cols-2'>
        {dimensionKeys.map((key) => {
          const value = assessment.dimensions[key];
          return <section key={key} className='rounded-lg bg-muted/50 p-3'>
            <div className='flex items-center justify-between gap-2'><h4 className='text-sm font-medium'>{t(`knowledge.dimension.${key}`)}</h4><span className='text-xs text-muted-foreground'>{value.score}/100 · {t(`knowledge.status.${value.status}`)}</span></div>
            <ul className='mt-2 grid gap-1'>{value.factors.map((factor) => <li key={factor.code} className='text-xs text-muted-foreground'>{factor.message}</li>)}</ul>
          </section>;
        })}
      </div>
    </details>
  );
}
