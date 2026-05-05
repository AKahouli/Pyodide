import { type NodeProps } from '@xyflow/react';
import { RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookNodeData } from '../types';

export function PlaybookIteratorContainerNode({ data, selected }: NodeProps) {
  const node = data as PlaybookNodeData & { childTaskIds?: string[] };
  const { t } = useModuleTranslation('playbook');
  const childCount = node.childTaskIds?.length || 0;

  return (
    <div className={`h-full w-full rounded-xl border-2 border-dashed bg-amber-50/60 ${selected ? 'border-[#ffcd03] shadow-lg shadow-[#ffcd03]/20' : 'border-amber-300/80'}`}>
      <div className="flex items-center justify-between rounded-t-lg border-b border-amber-300/70 bg-amber-100/80 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-200 text-amber-900">
            <RefreshCcw className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-amber-950">{node.title || t('nodeEditor.nodeTypeIterator')}</div>
            <div className="text-xs text-amber-900/80">{node.iteratorConfig?.source || t('node.iteratorNotConfigured')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-amber-400/70 bg-amber-50 text-amber-900">
            {node.iteratorConfig?.mode === 'batch' ? t('nodeEditor.iteratorModeBatch') : t('nodeEditor.iteratorModeItem')}
          </Badge>
          <Badge variant="outline" className="border-amber-400/70 bg-amber-50 text-amber-900">
            {t('iterator.childCount', { count: childCount })}
          </Badge>
        </div>
      </div>
      <div className="pointer-events-none h-[calc(100%-52px)] rounded-b-lg px-4 py-3 text-xs text-amber-900/75">
        {node.description || t('iterator.dropHint')}
      </div>
    </div>
  );
}
