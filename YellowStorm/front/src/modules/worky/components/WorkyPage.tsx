import type { JSX } from 'react';
import { StreamsDashboard } from './desktop/StreamsDashboard';

/**
 * Worky landing page. The dashboard is the only surface here — stream search,
 * creation and deletion all live inside it, so desktop and mobile share the
 * same full-width layout.
 */
export function WorkyPage(): JSX.Element {
  return (
    <div className="h-full w-full overflow-y-auto">
      <StreamsDashboard />
    </div>
  );
}
