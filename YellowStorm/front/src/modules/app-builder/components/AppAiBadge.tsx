import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
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
            className={cn(
              'h-5 shrink-0 gap-0.5 border-primary/25 bg-primary/10 px-2 text-[10px] font-medium text-primary',
              className,
            )}
            aria-label={t('card.aiFeatures')}
          >
            <Sparkles className='size-2.5' aria-hidden />
            {t('card.ai')}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side='top'>{t('card.aiFeaturesHint')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
