import type { ReactNode } from 'react';

export function AuthScrollShell({ children }: { children: ReactNode }) {
  return <div className='relative flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto'>{children}</div>;
}
