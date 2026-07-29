/**
 * Upgrade Page
 * Displays available plans for upgrade
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/modules/auth';
import { useUsage } from '../UsageContext';
import type { Plan } from '../types';
import { PlanCard } from './PlanCard';
import { UpgradeHeader } from './UpgradeHeader';

export function UpgradePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Use plans from context
  const { plans } = useUsage();

  const currentPlanSlug = user?.plan?.slug;
  // Show skeleton while we have no plans (handles both initial load and context loading)
  const isLoading = plans.length === 0;

  const handleSelectPlan = (plan: Plan) => {
    // TODO: Implement plan selection/upgrade flow
    console.log('Selected plan:', plan);
    // This would typically redirect to a payment page or call an API
  };

  const sortedPlans = React.useMemo(() => {
    return [...plans].sort((a, b) => a.displayOrder - b.displayOrder);
  }, [plans]);

  return (
    <div className='min-h-screen bg-background w-full'>
      {/* Fixed Header - always visible */}
      <div className='sticky top-0 z-10 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 border-b'>
        <div className='container mx-auto px-4 py-4 sm:px-6 lg:px-8'>
          <UpgradeHeader onBack={() => navigate(-1)} />
        </div>
      </div>

      {/* Scrollable Content */}
      <main className='container mx-auto px-4 py-8 sm:px-6 lg:px-8'>
        {isLoading ? (
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 max-w-7xl mx-auto'>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className='h-125 rounded-xl border-2 border-border bg-muted/50 animate-pulse' />
            ))}
          </div>
        ) : (
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 max-w-7xl mx-auto'>
            {sortedPlans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} isCurrentPlan={plan.slug === currentPlanSlug} onSelect={handleSelectPlan} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
