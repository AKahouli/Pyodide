import { type NodeProps } from '@xyflow/react';
import { RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookNodeData } from '../types';

export function PlaybookIteratorContainerNode({ data, selected }: NodeProps) {
  const node = data as PlaybookNodeData & { childTaskIds?: string[] };
  const { t } = useModuleTranslation('playbook');
  const childCount = node.childTaskIds?.length || 0;
  const isEmpty = childCount === 0;

  return (
    <div className={`h-full w-full overflow-hidden rounded-xl border-2 border-dashed transition-colors ${selected ? 'border-primary shadow-lg shadow-primary/20' : 'border-border'} ${isEmpty ? 'bg-muted/35' : 'bg-muted/20'}`}>
      <div className="flex items-center justify-between border-b border-border/80 bg-background/70 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <RefreshCcw className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-foreground">{node.title || t('nodeEditor.nodeTypeIterator')}</div>
            <div className="text-xs text-muted-foreground">{node.iteratorConfig?.source || t('node.iteratorNotConfigured')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-border bg-background/80 text-foreground">
            {node.iteratorConfig?.mode === 'batch' ? t('nodeEditor.iteratorModeBatch') : t('nodeEditor.iteratorModeItem')}
          </Badge>
          <Badge variant="outline" className="border-border bg-background/80 text-foreground">
            {t('iterator.childCount', { count: childCount })}
          </Badge>
        </div>
      </div>
      <div className="pointer-events-none flex h-[calc(100%-52px)] items-start rounded-b-lg p-4">
        <div className={`w-full rounded-lg border border-dashed px-4 py-3 text-xs ${isEmpty ? 'border-primary/40 bg-background/30 text-muted-foreground' : 'border-border/70 bg-background/20 text-muted-foreground'}`}>
          {node.description || t('iterator.dropHint')}
        </div>
      </div>
    </div>
  );
}
