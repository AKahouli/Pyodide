/**
 * Usage Limit Banner
 * Displays inline above the chat input when user has exceeded their plan's token limit
 */

import { useNavigate } from 'react-router-dom';
import { Clock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useUsage } from '../UsageContext';

export function UsageLimitBanner() {
  const navigate = useNavigate();
  const { status } = useUsage();
  const { t, language } = useModuleTranslation('usage');

  if (!status?.isLimitExceeded) return null;

  const resetDate = new Date(status.resetsAt);

  // Format: "Tuesday, Jan 28"
  const formattedDate = new Intl.DateTimeFormat(language, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(resetDate);

  // Format: "6:00 PM"
  const formattedTime = new Intl.DateTimeFormat(language, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(resetDate);

  return (
    <div className='animate-in fade-in duration-300 rounded-lg border  p-4 border-b-0 rounded-b-none'>
      <div className='flex items-start gap-3'>
        <Clock className='h-5 w-5 text-muted-foreground mt-0.5 shrink-0' />
        <div className='flex-1  space-y-2'>
          <p className='text-sm text-foreground'>{t('usage.banner.limitReached', { plan: status.plan.name })}</p>
          <p className='text-sm text-muted-foreground'>{t('usage.banner.resetsOn', { date: formattedDate, time: formattedTime })}</p>
        </div>
        <Button onClick={() => navigate('/upgrade')} size='sm' variant='outline' className='mt-2'>
          <Sparkles className='h-4 w-4 mr-2' />
          {t('usage.banner.upgradeCta')}
        </Button>
      </div>
    </div>
  );
}
