import { useModuleTranslation } from '@/modules/localization';
import { formatFinalizedDate } from '@/modules/conversation-v2/utils/finalized-versions';
import type { AppRevisionCatalogFields } from '../types';

interface AppRevisionMetaProps {
  revision: Pick<
    AppRevisionCatalogFields,
    | 'lastDeployedRevisionId'
    | 'latestFinalizedRevisionId'
    | 'latestFinalizedAt'
    | 'finalizedVersionCount'
  >;
  /** When false, hide the deployed revision line (draft cards). */
  showDeployedRevision?: boolean;
}

export function AppRevisionMeta({
  revision,
  showDeployedRevision = true,
}: AppRevisionMetaProps) {
  const { t, language } = useModuleTranslation('app-builder');
  const locale = language || 'en';
  const {
    lastDeployedRevisionId,
    latestFinalizedRevisionId,
    latestFinalizedAt,
    finalizedVersionCount,
  } = revision;

  const hasDeployedRevision =
    showDeployedRevision && !!lastDeployedRevisionId?.trim();
  const hasLatestFinalized = !!latestFinalizedRevisionId?.trim();
  if (!hasDeployedRevision && !hasLatestFinalized) return null;

  const latestDate =
    latestFinalizedAt != null
      ? formatFinalizedDate(latestFinalizedAt, locale)
      : null;

  return (
    <div className='mt-1 space-y-0.5'>
      {hasDeployedRevision && (
        <p className='text-[11px] text-muted-foreground'>
          {t('card.deployedRevision', { revision: lastDeployedRevisionId })}
        </p>
      )}
      {hasLatestFinalized && (
        <p className='text-[11px] text-muted-foreground'>
          {finalizedVersionCount > 1
            ? t('card.latestRevisionWithCount', {
                revision: latestFinalizedRevisionId,
                date: latestDate ?? '',
                count: finalizedVersionCount,
              })
            : t('card.latestRevision', {
                revision: latestFinalizedRevisionId,
                date: latestDate ?? '',
              })}
        </p>
      )}
    </div>
  );
}
