/**
 * Usage Section for Settings Modal
 * Shows current usage with progress bars
 */

import * as React from 'react';
import { RefreshCw, Zap, Clock, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUsage } from '../UsageContext';
import { useSettingsModal } from '@/modules/profile';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';

export function UsageSection() {
  const { status, isLoading, refreshUsage } = useUsage();
  const { closeSettings } = useSettingsModal();
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const { t } = useModuleTranslation('usage');

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshUsage();
    setIsRefreshing(false);
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const formatTimeRemaining = () => {
    if (!status) return '';
    const resetTime = new Date(status.resetsAt);
    const now = new Date();
    const diff = resetTime.getTime() - now.getTime();

    if (diff <= 0) return t('usage.window.resetting');

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return t('usage.window.timeWithHours', { hours, minutes });
    }
    return t('usage.window.timeWithMinutes', { minutes });
  };
  const getProgressColor = (percent: number) => {
    if (percent >= 90) return 'bg-rose-500';
    if (percent >= 70) return 'bg-amber-500';
    if (percent >= 50) return 'bg-yellow-400';
    if (percent >= 30) return 'bg-lime-400';
    if (percent >= 0) return 'bg-green-400';
    return 'bg-rose-500';
  };

  if (isLoading && !status) {
    return (
      <div className='space-y-6'>
        <div>
          <h2 className='text-xl font-semibold'>{t('usage.title')}</h2>
          <p className='text-sm text-muted-foreground'>{t('usage.description')}</p>
        </div>
        <Separator />
        <div className='space-y-4'>
          {[1, 2, 3].map((i) => (
            <div key={i} className='h-24 rounded-lg bg-muted animate-pulse' />
          ))}
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className='space-y-6'>
        <div>
          <h2 className='text-xl font-semibold'>{t('usage.title')}</h2>
          <p className='text-sm text-muted-foreground'>{t('usage.description')}</p>
        </div>
        <Separator />
        <div className='text-center py-8'>
          <p className='text-muted-foreground'>{t('usage.loadError')}</p>
          <Button variant='outline' className='mt-4' onClick={handleRefresh}>
            <RefreshCw className='h-4 w-4 mr-2' />
            {t('usage.actions.retry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-xl font-semibold'>{t('usage.title')}</h2>
          <p className='text-sm text-muted-foreground'>{t('usage.description')}</p>
        </div>
        <Button variant='ghost' size='sm' onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
          {t('usage.actions.refresh')}
        </Button>
      </div>

      <Separator />

      {/* Current Plan */}
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle className='text-base'>{t('usage.plan.title')}</CardTitle>
              <CardDescription>{t('usage.plan.name', { name: status.plan.name })}</CardDescription>
            </div>
            <Badge variant='outline' className={cn(status.plan.isUnlimited ? 'border-amber-500 text-amber-600' : 'border-primary text-primary')}>
              {status.plan.isUnlimited ? t('usage.plan.unlimitedBadge') : t('usage.plan.windowBadge', { hours: status.plan.windowHours })}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant='outline' size='sm' onClick={closeSettings}>
            <Zap className='h-4 w-4 mr-2' />
            {t('usage.plan.upgrade')}
          </Button>
        </CardContent>
      </Card>

      {/* Token Usage */}
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle className='text-base flex items-center gap-2'>
                <TrendingUp className='h-4 w-4' />
                {t('usage.tokens.title')}
              </CardTitle>
              <CardDescription>{status.tokens.isUnlimited ? t('usage.tokens.unlimited') : t('usage.tokens.remaining', { value: formatNumber(status.tokens.remaining) })}</CardDescription>
            </div>
            {!status.tokens.isUnlimited && <span className={cn('text-2xl font-bold', status.tokens.percentUsed >= 90 && 'text-rose-500', status.tokens.percentUsed >= 70 && status.tokens.percentUsed < 90 && 'text-amber-500')}>{t('usage.tokens.percent', { value: Math.round(status.tokens.percentUsed) })}</span>}
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          {!status.tokens.isUnlimited && (
            <div className='space-y-2'>
              <Progress value={status.tokens.percentUsed} className='h-3' indicatorClassName={getProgressColor(status.tokens.percentUsed)} />
              <div className='flex justify-between text-sm text-muted-foreground'>
                <span>{t('usage.tokens.used', { value: formatNumber(status.tokens.total) })}</span>
                <span>{t('usage.tokens.limit', { value: formatNumber(status.tokens.limit) })}</span>
              </div>
            </div>
          )}

          <div className='grid grid-cols-2 gap-4 pt-2'>
            <div className='rounded-lg bg-muted p-3'>
              <p className='text-xs text-muted-foreground'>{t('usage.tokens.inputLabel')}</p>
              <p className='text-lg font-semibold'>{formatNumber(status.tokens.input)}</p>
            </div>
            <div className='rounded-lg bg-muted p-3'>
              <p className='text-xs text-muted-foreground'>{t('usage.tokens.outputLabel')}</p>
              <p className='text-lg font-semibold'>{formatNumber(status.tokens.output)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reset Timer */}
      {!status.tokens.isUnlimited && (
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base flex items-center gap-2'>
              <Clock className='h-4 w-4' />
              {t('usage.window.title')}
            </CardTitle>
            <CardDescription>{t('usage.window.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-sm text-muted-foreground'>{t('usage.window.resetsIn')}</p>
                <p className='text-2xl font-bold text-primary'>{formatTimeRemaining()}</p>
              </div>
              <div className='text-right'>
                <p className='text-sm text-muted-foreground'>{t('usage.requests.label')}</p>
                <p className='text-lg font-semibold'>{status.requests.count.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
