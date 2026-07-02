import { Undo2, X } from 'lucide-react';
import { useEffect } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkyLastDeltaToast, useWorkyStore } from '../store';

/**
 * Auto-applied plan-delta toast. The runtime already wrote the delta
 * to the backend, so Undo just clears the toast and lets the
 * following SSE `kanban.updated` event refetch the board. A real
 * revert endpoint is Part 3/4 scope (canonical §3.2).
 */
export function PlanDeltaToast(): JSX.Element | null {
  const { t } = useModuleTranslation('worky');
  const toast = useWorkyLastDeltaToast();
  const setLastDeltaToast = useWorkyStore((s) => s.setLastDeltaToast);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setLastDeltaToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast, setLastDeltaToast]);
  if (!toast) return null;
  return (
    <div className='pointer-events-none fixed bottom-20 left-1/2 z-40 -translate-x-1/2 transform'>
      <div className='pointer-events-auto flex items-center gap-3 rounded-md border border-border/60 bg-background/95 px-4 py-2 shadow-md backdrop-blur'>
        <span className='text-sm'>{toast.summary}</span>
        <button
          type='button'
          onClick={() => setLastDeltaToast(null)}
          className='flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground'
        >
          <Undo2 className='h-3 w-3' aria-hidden />
          {t('toast.undo')}
        </button>
        <button
          type='button'
          onClick={() => setLastDeltaToast(null)}
          aria-label={t('toast.dismiss')}
          className='rounded p-1 text-muted-foreground hover:text-foreground'
        >
          <X className='h-3 w-3' aria-hidden />
        </button>
      </div>
    </div>
  );
}
