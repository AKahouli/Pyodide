import { useModuleTranslation } from '@/modules/localization';

interface ContextMeterProps {
  usedTokens: number;
  contextWindow: number;
  model: string;
}

export function ContextMeter({ usedTokens, contextWindow, model }: ContextMeterProps) {
  const { t } = useModuleTranslation('conversation');
  if (usedTokens <= 0 || contextWindow <= 0) return null;

  const ratio = Math.min(usedTokens / contextWindow, 1);
  const percentage = Math.round(ratio * 100);
  const circumference = 2 * Math.PI * 8;

  return (
    <div
      className='flex items-center gap-2 text-xs text-muted-foreground'
      aria-label={t('input.contextMeter.label', { percentage, model })}
      title={t('input.contextMeter.detail', {
        used: usedTokens.toLocaleString(),
        total: contextWindow.toLocaleString(),
        model,
      })}
    >
      <svg className='size-5 -rotate-90' viewBox='0 0 20 20' aria-hidden='true'>
        <circle cx='10' cy='10' r='8' fill='none' stroke='currentColor' strokeWidth='2' opacity='0.18' />
        <circle
          cx='10'
          cy='10'
          r='8'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span>{t('input.contextMeter.compact', { percentage })}</span>
    </div>
  );
}
