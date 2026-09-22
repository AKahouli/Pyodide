/**
 * Edge wrapper that adds a hover/selection "insert step" affordance at the edge
 * midpoint. Wraps the existing edge components so their visuals stay unchanged.
 */

import { createContext, useContext } from 'react';
import type { ComponentType } from 'react';
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';

export const EdgeInsertContext = createContext<{ onInsertStep: (edgeId: string) => void } | null>(null);

export function makeInsertableEdge(BaseEdgeComponent: ComponentType<EdgeProps>, labelOffsetY = 0) {
  function InsertableEdge(props: EdgeProps) {
    const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data } = props;
    const { t } = useModuleTranslation('playbook');
    const insert = useContext(EdgeInsertContext);
    // Runtime projections and the data-binding overlay layer are not editable routes.
    const edgeData = (data || {}) as { runtime?: boolean; layer?: string };
    const editable = !edgeData.runtime && edgeData.layer !== 'binding';
    const [, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });

    return (
      <>
        <BaseEdgeComponent {...props} />
        {editable && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan group pointer-events-auto absolute p-1.5"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY + labelOffsetY}px)` }}
          >
            <button
              type="button"
              aria-label={t('nextStep.insertOnEdge')}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-opacity hover:text-foreground',
                selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
              onClick={(event) => {
                event.stopPropagation();
                insert?.onInsertStep(id);
              }}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </EdgeLabelRenderer>
        )}
      </>
    );
  }
  return InsertableEdge;
}
