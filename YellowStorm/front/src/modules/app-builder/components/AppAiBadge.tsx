import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useModuleTranslation } from '@/modules/localization';

interface AppAiBadgeProps {
  className?: string;
}

/** Compact catalog chip for apps that integrate AI features. */
export function AppAiBadge({ className }: AppAiBadgeProps) {
  const { t } = useModuleTranslation('app-builder');

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant='outline'
            className={
              className ??
              'shrink-0 gap-0.5 border-violet-500/35 bg-violet-500/10 px-1.5 py-0 text-[10px] font-medium text-violet-800 dark:text-violet-200'
            }
            aria-label={t('card.aiFeatures')}
          >
            <Sparkles className='h-2.5 w-2.5' aria-hidden />
            {t('card.ai')}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side='top'>{t('card.aiFeaturesHint')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
