import { useEffect, useState } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import type { IndexingAttemptTiming, IndexingStatus } from '../types';

/** Use persisted attempt timestamps so refreshes and terminal failures keep the real duration. */
export function FileIndexingDuration({ indexingAttemptStartedAt, indexingAttemptCompletedAt, status }: IndexingAttemptTiming & { status?: IndexingStatus }) {
  const { t } = useModuleTranslation('workspace');
  const [now, setNow] = useState(Date.now);
  const start = Date.parse(indexingAttemptStartedAt ?? '');
  const end = Date.parse(indexingAttemptCompletedAt ?? '');
  const running = status === 'processing' && Number.isFinite(start) && indexingAttemptCompletedAt == null;

  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, start]);

  const finished = (status === 'ready' || status === 'failed') && Number.isFinite(end) && end >= start;
  if (!Number.isFinite(start) || (!running && !finished) || (running && now < start)) return null;
  const totalSeconds = Math.floor(((running ? now : end) - start) / 1000);
  const params = { hours: Math.floor(totalSeconds / 3600), minutes: Math.floor(totalSeconds / 60) % 60, seconds: totalSeconds % 60 };
  const duration = t(`indexing.duration.${totalSeconds >= 3600 ? 'hours' : totalSeconds >= 60 ? 'minutes' : 'seconds'}`, params);
  const label = t('indexing.elapsed', { duration });
  return <span className='whitespace-nowrap tabular-nums' title={label} aria-label={label}>{duration}</span>;
}
