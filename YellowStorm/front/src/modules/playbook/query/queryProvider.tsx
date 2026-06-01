import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { playbookQueryClient } from '@/modules/playbook/query/queryClient';

type PlaybookQueryProviderProps = Readonly<{
  children: ReactNode;
}>;

export function PlaybookQueryProvider({ children }: PlaybookQueryProviderProps) {
  return (
    <QueryClientProvider client={playbookQueryClient}>
      {children}
    </QueryClientProvider>
  );
}
