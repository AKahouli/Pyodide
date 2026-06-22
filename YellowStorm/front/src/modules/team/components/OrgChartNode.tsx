import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Crown, Trash2, ArrowUp } from 'lucide-react';
import type { OrgChartNodeData } from '../hooks/useTeamCanvas';
import { useModuleTranslation } from '@/modules/localization';

export const OrgChartNode = memo(function OrgChartNode({
  id,
  data: rawData,
}: NodeProps) {
  const data = rawData as unknown as OrgChartNodeData;
  const { t } = useModuleTranslation('team');
  const isRoot = !data.parentAgentId;

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Card className='relative w-[280px] gap-0 rounded-md p-0 overflow-hidden'>
          <Handle
            position={Position.Top}
            type='target'
            className='!bg-primary !w-3 !h-3 !border-2 !border-background'
          />

          <CardHeader className='gap-0.5 rounded-t-md border-b p-3!'>
            <div className='flex items-center gap-2'>
              {(isRoot || data.hasChildren) && (
                <Crown className='h-3.5 w-3.5 text-amber-500 shrink-0' />
              )}
              <CardTitle className='text-sm font-medium truncate'>
                {data.agentName}
              </CardTitle>
            </div>
            <div className='flex items-center gap-1.5 mt-1'>
              {data.agentTypeName && (
                <Badge variant='secondary' className='text-[10px] px-1.5 py-0'>
                  {data.agentTypeName}
                </Badge>
              )}
              {isRoot && (
                <Badge variant='outline' className='text-[10px] px-1.5 py-0'>
                  {t('node.root')}
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className='p-3'>
            <p className='text-xs text-muted-foreground line-clamp-2'>
              {data.agentDescription || t('node.noDescription')}
            </p>
          </CardContent>

          <Handle
            position={Position.Bottom}
            type='source'
            className='!bg-primary !w-3 !h-3 !border-2 !border-background'
          />
        </Card>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => {
            const event = new CustomEvent('team:set-root', {
              detail: { agentId: id },
            });
            window.dispatchEvent(event);
          }}
        >
          <ArrowUp className='mr-2 h-4 w-4' />
          {t('node.setAsRoot')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className='text-destructive'
          onClick={() => {
            const event = new CustomEvent('team:remove-member', {
              detail: { agentId: id },
            });
            window.dispatchEvent(event);
          }}
        >
          <Trash2 className='mr-2 h-4 w-4' />
          {t('node.removeFromTeam')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
