import { AlertCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { ModelCheckIssue } from '../../types';
import { issueText, sortIssues, worstSeverity } from '../../utils/model-check';

const SHOWN = 6;

/** A small red (error) or amber (warning) mark on a box or line; its tooltip lists what is wrong, each a way in to fix it. */
export function CheckBadge({ issues, onOpen, className }: Readonly<{
  issues: readonly ModelCheckIssue[];
  /** Opens the editor where the issue is fixed. */
  onOpen?: (issue: ModelCheckIssue) => void;
  className?: string;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const severity = worstSeverity(issues);
  if (!severity) return null;
  const sorted = sortIssues(issues);
  const Icon = severity === 'error' ? AlertCircle : AlertTriangle;
  const translate = t as (key: string | string[], options?: Record<string, unknown>) => string;
  return <span className={cn('group/check nodrag nopan pointer-events-auto relative inline-flex', className)} data-severity={severity}>
    <button type='button' aria-label={translate('check.badge', { count: sorted.length })}
      className={cn('flex h-6 w-6 items-center justify-center rounded-full border-2 border-background shadow-sm transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary', severity === 'error' ? 'bg-destructive text-destructive-foreground' : 'bg-amber-400 text-amber-950')}
      onClick={(event) => { event.stopPropagation(); if (sorted[0]) onOpen?.(sorted[0]); }}>
      <Icon className='h-3.5 w-3.5' aria-hidden />
    </button>
    {/* Touches the badge (padding, not margin) so the pointer can travel into the list. */}
    <span role='tooltip' className='absolute left-1/2 top-full z-50 hidden -translate-x-1/2 pt-1.5 group-hover/check:block group-focus-within/check:block'>
      <span className='block w-64 space-y-1 rounded-xl border bg-popover p-2 text-start text-xs text-popover-foreground shadow-xl'>
        {sorted.slice(0, SHOWN).map((issue, index) => <button key={`${issue.code}-${issue.fieldId ?? ''}-${index}`} type='button' onClick={(event) => { event.stopPropagation(); onOpen?.(issue); }}
          className='flex w-full gap-1.5 rounded-lg p-1.5 text-start hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'>
          {issue.severity === 'error' ? <AlertCircle className='mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive' aria-hidden /> : <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600' aria-hidden />}
          <span className='min-w-0 whitespace-normal break-words'>{issueText(translate, issue)}</span>
        </button>)}
        {sorted.length > SHOWN && <span className='block px-1.5 text-muted-foreground'>{translate('check.more', { count: sorted.length - SHOWN })}</span>}
      </span>
    </span>
  </span>;
}
