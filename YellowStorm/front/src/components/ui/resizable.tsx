import * as React from 'react';
import { GripHorizontal } from 'lucide-react';
import { Group, Panel, Separator } from 'react-resizable-panels';

import { cn } from '@/lib/utils';

const ResizablePanelGroup = ({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof Group>) => (
  <Group
    className={cn('flex h-full w-full', orientation === 'vertical' && 'flex-col', className)}
    orientation={orientation}
    {...props}
  />
);

const ResizablePanel = Panel;

const ResizableHandle = ({
  withHandle,
  className,
  orientation,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
  orientation?: 'horizontal' | 'vertical';
}) => (
  <Separator
    className={cn(
      'relative flex items-center justify-center bg-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
      orientation === 'vertical'
        ? 'h-px w-full cursor-row-resize'
        : 'w-px h-full cursor-col-resize',
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className={cn(
        'z-10 flex items-center justify-center rounded-sm border bg-border',
        orientation === 'vertical' ? 'h-3 w-4 rotate-90' : 'h-4 w-3',
      )}>
        <GripHorizontal className="h-2.5 w-2.5" />
      </div>
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
