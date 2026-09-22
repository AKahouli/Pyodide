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

/**
 * Catalog cards only expose revision ids + total count — not the full list.
 * Same rule as Version History: oldest finalized = Version 1, latest = Version N.
 * Without the list we can only resolve the latest (always N) and any id that
 * matches it (or the sole version when count === 1).
 */
export function resolveCatalogVersionNumber(
  revisionId: string | null | undefined,
  latestFinalizedRevisionId: string | null | undefined,
  finalizedVersionCount: number,
): number | null {
  const id = revisionId?.trim();
  if (!id || finalizedVersionCount < 1) return null;
  const latest = latestFinalizedRevisionId?.trim() || null;
  if (latest && id === latest) return finalizedVersionCount;
  if (finalizedVersionCount === 1) return 1;
  return null;
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

  const deployedNumber = resolveCatalogVersionNumber(
    lastDeployedRevisionId,
    latestFinalizedRevisionId,
    finalizedVersionCount,
  );
  const latestNumber = resolveCatalogVersionNumber(
    latestFinalizedRevisionId,
    latestFinalizedRevisionId,
    finalizedVersionCount,
  );

  const hasDeployedRevision =
    showDeployedRevision && !!lastDeployedRevisionId?.trim() && deployedNumber != null;
  const hasLatestFinalized =
    !!latestFinalizedRevisionId?.trim() && latestNumber != null;
  if (!hasDeployedRevision && !hasLatestFinalized) return null;

  const latestDate =
    latestFinalizedAt != null
      ? formatFinalizedDate(latestFinalizedAt, locale)
      : null;

  const deployedLabel = t('card.version', { number: deployedNumber });
  const latestLabel = t('card.version', { number: latestNumber });

  return (
    <div className='mt-2 space-y-0.5 border-t border-border/40 pt-2'>
      {hasDeployedRevision && (
        <p
          className='truncate text-[11px] text-muted-foreground'
          title={lastDeployedRevisionId ?? undefined}
        >
          {t('card.deployedRevision', { version: deployedLabel })}
        </p>
      )}
      {hasLatestFinalized && (
        <p
          className='truncate text-[11px] text-muted-foreground'
          title={latestFinalizedRevisionId ?? undefined}
        >
          {finalizedVersionCount > 1
            ? t('card.latestRevisionWithCount', {
                version: latestLabel,
                date: latestDate ?? '',
                count: finalizedVersionCount,
              })
            : t('card.latestRevision', {
                version: latestLabel,
                date: latestDate ?? '',
              })}
        </p>
      )}
    </div>
  );
}
