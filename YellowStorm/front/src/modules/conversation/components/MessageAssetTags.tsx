import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { DisplayAssetTag } from '../utils/asset-message-display';

export function MessageAssetTags({ assets, inverse = false }: { assets: DisplayAssetTag[]; inverse?: boolean }) {
  const { t } = useModuleTranslation('conversation');
  if (!assets.length) return null;
  return <div className='mt-2 flex max-w-full flex-wrap gap-1.5' role='group' aria-label={t('assets.selectedFiles')}>
    {assets.map((asset, index) => <span key={index} className={cn('inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs', inverse ? 'border-primary-foreground/25 bg-primary-foreground/10' : 'border-border bg-muted/40')}>
      <FileText className='size-3 shrink-0 opacity-70' aria-hidden />
      <span className='min-w-0 truncate' title={asset.name}>{asset.name}</span>
    </span>)}
  </div>;
}
