import { useQuery } from '@tanstack/react-query';

import { getDesignOperation } from '@/modules/playbook/api';
import { playbookQueryClient } from '@/modules/playbook/query/queryClient';
import { playbookKeys } from '@/modules/playbook/query/queryKeys';

export function useDesignOperationQuery(playbookId: string, operationId: string | null) {
  return useQuery({
    queryKey: playbookKeys.designOperation(playbookId, operationId ?? 'pending'),
    queryFn: () => getDesignOperation(playbookId, operationId as string),
    enabled: Boolean(playbookId && operationId),
  }, playbookQueryClient);
}
