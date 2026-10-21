import { useModuleTranslation } from '@/modules/localization';
import type { WorkspaceFile } from '../types';

/** Receives the complete workspace list, before folder and search filtering. */
export function WorkspaceIndexingSummary({ files, workspaceId }: { files: WorkspaceFile[]; workspaceId: string }) {
  const { t } = useModuleTranslation('workspace');
  const counts = { total: 0, indexed: 0, failed: 0, processing: 0 };
  for (const file of files) {
    if (file.workspaceId !== workspaceId) continue;
    counts.total++;
    if (file.indexingStatus === 'ready') counts.indexed++;
    else if (file.indexingStatus === 'failed') counts.failed++;
    else if (file.indexingStatus === 'processing' || file.indexingStatus === 'pending' || (file.type === 'url' && file.status === 'processing')) counts.processing++;
  }
  return (
    <dl className='flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground' aria-label={t('indexing.summary')}>
      {(Object.keys(counts) as Array<keyof typeof counts>).map((key) => (
        <div key={key} className='flex items-center gap-2'>
          <dt>{t(`indexing.count.${key}`)}</dt>
          <dd className='font-medium tabular-nums text-foreground'>{counts[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
