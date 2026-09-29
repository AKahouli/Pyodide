import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { TemplatePlatformReport } from '../../types';

interface TemplatePlatformSummaryProps {
  report: TemplatePlatformReport | null;
}

/**
 * Super-admin view of what the Platform Kit will do to this template when a
 * session is created, so a broken upload is caught before a user's deploy.
 */
export function TemplatePlatformSummary({ report }: TemplatePlatformSummaryProps) {
  const { t } = useModuleTranslation('app-builder');
  if (!report) return null;

  const { Icon, tone, message } =
    report.status === 'incompatible'
      ? { Icon: AlertTriangle, tone: 'text-fail', message: t('platformReport.incompatible') }
      : report.status === 'needs_normalization'
        ? {
            Icon: Wrench,
            tone: 'text-muted-foreground',
            message: t('platformReport.needsNormalization', {
              count: report.injectedFiles.length,
            }),
          }
        : { Icon: CheckCircle2, tone: 'text-muted-foreground', message: t('platformReport.ready') };

  return (
    <section className='space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3'>
      <p className='text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground'>
        {t('platformReport.heading')}
      </p>
      <p className={`flex items-start gap-2 text-sm ${tone}`}>
        <Icon className='mt-0.5 size-4 shrink-0' aria-hidden />
        <span>{message}</span>
      </p>
      <FileList label={t('platformReport.violations')} items={report.violations} />
      <FileList label={t('platformReport.warnings')} items={report.warnings} />
      <FileList label={t('platformReport.injectedFiles')} items={report.injectedFiles} />
    </section>
  );
}

function FileList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <details className='text-xs text-muted-foreground'>
      <summary className='cursor-pointer select-none'>
        {label} ({items.length})
      </summary>
      <ul className='mt-1 space-y-0.5 pl-4'>
        {items.map((item) => (
          <li key={item} className='break-all font-mono text-[11px]'>
            {item}
          </li>
        ))}
      </ul>
    </details>
  );
}
