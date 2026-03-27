import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Check, Sparkles, Zap, Building2, Infinity } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Plan } from '../types';
import { CURRENT_PLAN_COLOR, formatStorageSize } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization/types';

const PLAN_ICONS: Record<string, React.ReactNode> = {
  free: <Sparkles className='h-6 w-6' />,
  basic: <Zap className='h-6 w-6' />,
  enterprise: <Building2 className='h-6 w-6' />,
  unlimited: <Infinity className='h-6 w-6' />,
};

const FEATURE_TRANSLATION_KEYS: Record<string, ModuleTranslationKey<'usage'>> = {
  basic_chat: 'usage.upgrade.features.labels.basicChat',
  history: 'usage.upgrade.features.labels.history',
  export: 'usage.upgrade.features.labels.export',
  api_access: 'usage.upgrade.features.labels.apiAccess',
  priority_support: 'usage.upgrade.features.labels.prioritySupport',
  analytics: 'usage.upgrade.features.labels.analytics',
  unlimited: 'usage.upgrade.features.labels.unlimited',
};

export type PlanCardProps = Readonly<{
  plan: Plan;
  isCurrentPlan: boolean;
  onSelect: (plan: Plan) => void;
}>;

export function PlanCard({ plan, isCurrentPlan, onSelect }: PlanCardProps) {
  const { t, language } = useModuleTranslation('usage');

  const formatTokenLimit = (limit: number) => {
    if (limit === -1) return t('usage.upgrade.metrics.unlimited');
    if (limit >= 1000000) {
      const value = (limit / 1000000).toLocaleString(language, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
      return t('usage.upgrade.metrics.millions', { value });
    }
    if (limit >= 1000) {
      const value = (limit / 1000).toLocaleString(language, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
      return t('usage.upgrade.metrics.thousands', { value });
    }
    return new Intl.NumberFormat(language).format(limit);
  };

  const formatPrice = (price: number) => {
    if (price === 0) return t('usage.upgrade.price.free');
    try {
      return new Intl.NumberFormat(language, { style: 'currency', currency: plan.currency }).format(price);
    } catch {
      return `$${price.toFixed(2)}`;
    }
  };

  let actionLabel = t('usage.upgrade.actions.upgrade');
  if (isCurrentPlan) {
    actionLabel = t('usage.upgrade.actions.current');
  } else if (plan.priceMonthly === 0) {
    actionLabel = t('usage.upgrade.actions.downgrade');
  }
  const showYearlyPricing = plan.priceYearly > 0 && plan.priceMonthly > 0;
  const yearlySavings = showYearlyPricing ? Math.max(0, Math.round((1 - plan.priceYearly / (plan.priceMonthly * 12)) * 100)) : 0;

  return (
    <div className={cn('relative rounded-xl p-4 sm:p-6 transition-all h-full flex flex-col', isCurrentPlan ? CURRENT_PLAN_COLOR : 'border-border border-2 hover:border-primary/50 hover:shadow-md')}>
      {isCurrentPlan && <Badge className='absolute -top-3 left-1/2 -translate-x-1/2 bg-primary hover:bg-primary'>{t('usage.upgrade.badges.current')}</Badge>}
      {plan.slug === 'enterprise' && !isCurrentPlan && <Badge className='absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-500 hover:bg-purple-500'>{t('usage.upgrade.badges.popular')}</Badge>}

      <div className='text-center mb-4 sm:mb-6'>
        <div className={cn('mx-auto w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center mb-3 sm:mb-4', isCurrentPlan ? 'text-primary' : 'bg-muted text-muted-foreground')}>{PLAN_ICONS[plan.slug] || <Sparkles className='h-5 w-5 sm:h-6 sm:w-6' />}</div>
        <h3 className='text-lg sm:text-xl font-bold truncate px-1'>{plan.name}</h3>
        {plan.description && <p className='text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2'>{plan.description}</p>}
      </div>

      <div className='text-center mb-4 sm:mb-6'>
        <div className='flex items-baseline justify-center gap-1'>
          <span className='text-3xl sm:text-4xl font-bold'>{formatPrice(plan.priceMonthly)}</span>
          {plan.priceMonthly > 0 && <span className='text-xs sm:text-sm text-muted-foreground'>{t('usage.upgrade.price.perMonthSuffix')}</span>}
        </div>
        {showYearlyPricing && <p className='text-xs sm:text-sm text-muted-foreground mt-1'>{t('usage.upgrade.price.perYearSavings', { price: formatPrice(plan.priceYearly), percent: yearlySavings })}</p>}
      </div>

      <Separator className='my-4 sm:my-6' />

      <div className='space-y-3 sm:space-y-4 mb-4 sm:mb-6 flex-1'>
        <div className='flex items-center justify-between text-xs sm:text-sm'>
          <span className='text-muted-foreground'>{t('usage.upgrade.metrics.tokensPerDay')}</span>
          <span className='font-semibold text-xs sm:text-sm'>{formatTokenLimit(plan.tokenLimit)}</span>
        </div>
        <div className='flex items-center justify-between text-xs sm:text-sm'>
          <span className='text-muted-foreground'>{t('usage.upgrade.metrics.requestsPerMinute')}</span>
          <span className='font-semibold text-xs sm:text-sm'>{plan.requestsPerMinute === -1 ? t('usage.upgrade.metrics.unlimited') : new Intl.NumberFormat(language).format(plan.requestsPerMinute)}</span>
        </div>
        <div className='flex items-center justify-between text-xs sm:text-sm'>
          <span className='text-muted-foreground'>{t('usage.upgrade.metrics.workspaces')}</span>
          <span className='font-semibold text-xs sm:text-sm'>{plan.maxWorkspaces === -1 ? t('usage.upgrade.metrics.unlimited') : new Intl.NumberFormat(language).format(plan.maxWorkspaces)}</span>
        </div>
        <div className='flex items-center justify-between text-xs sm:text-sm'>
          <span className='text-muted-foreground'>{t('usage.upgrade.metrics.storagePerWorkspace')}</span>
          <span className='font-semibold text-xs sm:text-sm'>{formatStorageSize(plan.workspaceStorageBytes, t('usage.upgrade.metrics.unlimited'))}</span>
        </div>
      </div>

      <Separator className='my-4 sm:my-6' />

      <div className='space-y-2 sm:space-y-3 mb-4 sm:mb-6 flex-1'>
        <p className='text-xs sm:text-sm font-medium'>{t('usage.upgrade.features.included')}</p>
        {plan.features.map((feature) => (
          <div key={feature} className='flex items-center gap-2 text-xs sm:text-sm'>
            <Check className={cn('h-3 w-3 sm:h-4 sm:w-4 shrink-0', isCurrentPlan ? 'text-primary' : 'text-green-500')} />
            <span className='leading-tight'>{FEATURE_TRANSLATION_KEYS[feature] ? t(FEATURE_TRANSLATION_KEYS[feature]) : feature}</span>
          </div>
        ))}
      </div>

      <Button className={cn('w-full text-sm sm:text-base', isCurrentPlan && 'bg-primary hover:bg-primary/90 mt-auto')} variant={isCurrentPlan ? 'default' : 'outline'} disabled={isCurrentPlan} onClick={() => onSelect(plan)}>
        {actionLabel}
      </Button>
    </div>
  );
}
