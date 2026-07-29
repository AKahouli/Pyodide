import type { JSX } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TaskDetailDrawer } from '../TaskDetailDrawer';
import type { WorkyTask } from '../../types';

/** Bottom-sheet wrapper around the existing TaskDetailDrawer for the mobile layout. */
export function TaskDetailSheet({
  streamId,
  task,
  open,
  onOpenChange,
}: {
  streamId: string;
  task: WorkyTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="sr-only">
          <SheetTitle>{task?.title ?? ''}</SheetTitle>
        </SheetHeader>
        <TaskDetailDrawer streamId={streamId} task={task} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
