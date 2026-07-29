import type { JSX } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { StreamSidebar } from './StreamSidebar';
import { StreamsDashboard } from './desktop/StreamsDashboard';

export function WorkyPage(): JSX.Element {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="h-full w-full overflow-y-auto">
        <StreamsDashboard />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      <StreamSidebar />
      <section className="flex-1 overflow-y-auto">
        <StreamsDashboard />
      </section>
    </div>
  );
}
