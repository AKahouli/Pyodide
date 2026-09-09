import { useQuery } from '@tanstack/react-query';
import { getPlaybookInputContract } from '@/modules/playbook/api';
import { playbookKeys } from '@/modules/playbook/query/queryKeys';

export function usePlaybookInputContract(playbookId: string | null | undefined) {
  return useQuery({
    queryKey: playbookKeys.inputContract(playbookId ?? ''),
    queryFn: () => getPlaybookInputContract(playbookId as string),
    enabled: Boolean(playbookId),
  });
}
