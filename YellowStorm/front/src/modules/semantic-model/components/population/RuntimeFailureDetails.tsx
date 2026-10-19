import { Fragment } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import type { RuntimeErrorDetails } from '../../types';

/** Display only the runtime's safe diagnostic projection, never arbitrary job results. */
export function RuntimeFailureDetails({ details, code, jobId }: Readonly<{
  details?: RuntimeErrorDetails | null;
  code?: string | null;
  jobId?: string;
}>) {
  const { t, language } = useModuleTranslation('semantic-model');
  const timestamp = details?.occurredAt ? new Date(details.occurredAt) : null;
  const fields = [
    ['runtimeError.code', details?.code ?? code],
    ['runtimeError.phase', details?.phase],
    ['runtimeError.attempt', details?.attempt],
    ['runtimeError.httpStatus', details?.httpStatus],
    ['runtimeError.sqlState', details?.sqlState],
    ['runtimeError.job', details?.jobId ?? jobId],
    ['runtimeError.task', details?.taskId],
    ['runtimeError.index', details?.indexId],
    ['runtimeError.when', timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp.toLocaleString(language) : null],
  ] as const;

  return <section className='min-w-0 space-y-2 border-t border-destructive/25 pt-3 text-xs' aria-label={t('runtimeError.title')}>
    <p className='font-semibold text-destructive'>{t('runtimeError.title')}{(details?.errorType ?? code) && <> · {details?.errorType ?? code}</>}</p>
    {details?.message && <p className='break-words text-foreground [overflow-wrap:anywhere]'>{details.message}</p>}
    {(!details || details.legacy) && <p className='text-muted-foreground'>{t('runtimeError.legacy')}</p>}
    <details className='min-w-0'>
      <summary className='cursor-pointer rounded-sm py-1 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'>{t('runtimeError.technical')}</summary>
      <dl className='mt-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5'>
        {fields.map(([label, value]) => value == null || value === '' ? null : <Fragment key={label}>
          <dt className='text-muted-foreground'>{t(label)}</dt>
          <dd className='min-w-0 break-words font-mono [overflow-wrap:anywhere]'>{value}</dd>
        </Fragment>)}
      </dl>
      {(details?.causes?.length ?? 0) > 0 && <div className='mt-3 space-y-1'>
        <p className='font-medium'>{t('runtimeError.causes')}</p>
        <ul className='space-y-2'>{details!.causes!.map((cause, i) => <li key={i} className='break-words [overflow-wrap:anywhere]'>
          <span className='font-mono'>{cause.errorType}</span>: {cause.message}
          {cause.sqlState && <p>{t('runtimeError.sqlState')}: <span className='font-mono'>{cause.sqlState}</span></p>}
          {cause.httpStatus != null && <p>{t('runtimeError.httpStatus')}: {cause.httpStatus}</p>}
        </li>)}</ul>
      </div>}
      {(details?.frames?.length ?? 0) > 0 && <div className='mt-3 space-y-1'>
        <p className='font-medium'>{t('runtimeError.frames')}</p>
        <ol className='space-y-1 font-mono'>{details!.frames!.map((frame, i) => <li key={i} className='break-words [overflow-wrap:anywhere]'>
          {frame.file}:{frame.line} · {frame.function}
        </li>)}</ol>
      </div>}
    </details>
  </section>;
}
