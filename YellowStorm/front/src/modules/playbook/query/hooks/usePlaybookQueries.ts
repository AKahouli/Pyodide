import { useQuery } from '@tanstack/react-query';

import { playbookFeatures } from '@/modules/playbook/features';
import {
  getFlow,
  getFlows,
  getPlaybooks,
  getPlaybookRepeatability,
} from '@/modules/playbook/api';
import { playbookKeys } from '@/modules/playbook/query/queryKeys';
import type { PlaybookQueryParams } from '@/modules/playbook/types';

/** Passive list read used during the Query migration; Zustand still owns UI state. */
export function usePlaybooksQuery(query?: PlaybookQueryParams) {
  return useQuery({
    queryKey: playbookKeys.list(query ?? {}),
    queryFn: () => getPlaybooks(query),
    enabled: playbookFeatures.queryEnabled,
  });
}

/** Base flow read for the fast canvas path, separated from replay enrichment. */
export function usePlaybookBaseQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: playbookKeys.detail(id ?? '', 'base'),
    queryFn: () => getFlow(id as string, { view: 'base' }),
    enabled: playbookFeatures.queryEnabled && Boolean(id),
  });
}

/** Enriched flow read for secondary replay and scoring metadata. */
export function usePlaybookEnrichedQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: playbookKeys.detail(id ?? '', 'enriched'),
    queryFn: () => getFlow(id as string, { view: 'enriched' }),
    enabled: playbookFeatures.queryEnabled && Boolean(id),
  });
}

export function usePlaybookRepeatabilityQuery(playbookId: string | null | undefined) {
  return useQuery({
    queryKey: [...playbookKeys.detail(playbookId ?? '', 'enriched'), 'repeatability'] as const,
    queryFn: () => getPlaybookRepeatability(playbookId as string),
    enabled: playbookFeatures.queryEnabled && Boolean(playbookId),
  });
}
