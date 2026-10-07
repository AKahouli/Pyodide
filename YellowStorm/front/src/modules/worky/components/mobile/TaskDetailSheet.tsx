import type { JSX } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TaskDetailDrawer } from '../TaskDetailDrawer';
import type { WorkyTask } from '../../types';

/** Bottom-sheet wrapper around the existing TaskDetailDrawer for the mobile layout. */
export function TaskDetailSheet({
  task,
  open,
  onOpenChange,
  tasks,
  onSelectTask,
  onDiscuss,
}: {
  task: WorkyTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks?: WorkyTask[];
  onSelectTask?: (task: WorkyTask) => void;
  onDiscuss?: () => void;
}): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="sr-only">
          <SheetTitle>{task?.title ?? ''}</SheetTitle>
        </SheetHeader>
        <TaskDetailDrawer task={task} onClose={() => onOpenChange(false)} tasks={tasks} onSelectTask={onSelectTask} onDiscuss={onDiscuss} />
      </SheetContent>
    </Sheet>
  );
}
