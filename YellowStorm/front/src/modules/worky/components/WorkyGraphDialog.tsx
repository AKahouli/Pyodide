import { useEffect, useRef } from 'react';
import type { WorkyTask } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import { WorkyGraphBoard } from './WorkyGraphBoard';

export function WorkyGraphDialog({ onClose, onTaskClick, attention }: {
  onClose: () => void;
  onTaskClick: (task: WorkyTask) => void;
  attention: { taskId: string; sequence: number } | null;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      window.requestAnimationFrame(() => {
        if (restoreFocus.current && !dialog?.isConnected) {
          document.querySelector<HTMLButtonElement>('[data-testid="worky-header-graph"]')?.focus();
        }
      });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={t('graph.title')}
      onCancel={(event) => {
        event.preventDefault();
        if (!event.currentTarget.querySelector('[data-testid="worky-graph-board"]')) onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-background p-0 backdrop:bg-transparent"
    >
      <WorkyGraphBoard initialFullscreen onExitFullscreen={onClose} onTaskClick={(task) => { restoreFocus.current = false; onTaskClick(task); }} attention={attention} />
    </dialog>
  );
}
