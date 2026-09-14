/**
 * Usage Context
 * Manages usage state and provides it to the app
 */

import * as React from 'react';
import { useAuth } from '@/modules/auth';
import { isPendingAdminApproval } from '@/modules/auth/utils/isPendingAdminApproval';
import * as usageApi from './api';
import type { UsageStatus, Plan, UsageContextType } from './types';

const UsageContext = React.createContext<UsageContextType | undefined>(undefined);

interface UsageProviderProps {
  children: React.ReactNode;
}

export function UsageProvider({ children }: UsageProviderProps) {
  const { isAuthenticated, user } = useAuth();
  const [status, setStatus] = React.useState<UsageStatus | null>(null);
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchUsageStatus = React.useCallback(async () => {
    if (!isAuthenticated || isPendingAdminApproval(user)) return;

    try {
      setIsLoading(true);
      setError(null);
      const usageStatus = await usageApi.getUsageStatus();
      setStatus(usageStatus);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch usage status';
      setError(message);
      console.error('Failed to fetch usage status:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user]);

  const fetchPlans = React.useCallback(async () => {
    try {
      const availablePlans = await usageApi.getPlans();
      setPlans(availablePlans);
    } catch (err) {
      console.error('Failed to fetch plans:', err);
    }
  }, []);

  const refreshUsage = React.useCallback(async () => {
    await Promise.all([fetchUsageStatus(), fetchPlans()]);
  }, [fetchUsageStatus, fetchPlans]);

  // Fetch usage status when user becomes authenticated
  React.useEffect(() => {
    if (isAuthenticated && user && !isPendingAdminApproval(user)) {
      fetchUsageStatus();
      fetchPlans();
    } else if (!isAuthenticated || !user) {
      setStatus(null);
      setPlans([]);
      setError(null);
    }
  }, [isAuthenticated, user, fetchUsageStatus, fetchPlans]);

  React.useEffect(() => {
    if (!isAuthenticated || isPendingAdminApproval(user)) return;

    const interval = setInterval(
      () => {
        fetchUsageStatus();
      },
      5 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, [isAuthenticated, user, fetchUsageStatus]);

  const value: UsageContextType = {
    status,
    plans,
    isLoading,
    error,
    fetchUsageStatus,
    fetchPlans,
    refreshUsage,
  };

  return <UsageContext.Provider value={value}>{children}</UsageContext.Provider>;
}

export function useUsage(): UsageContextType {
  const context = React.useContext(UsageContext);
  if (context === undefined) {
    throw new Error('useUsage must be used within a UsageProvider');
  }
  return context;
}

export { UsageContext };
