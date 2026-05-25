import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { LayoutGrid, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import { NodeDataActionsContext } from './PlaybookNode';
import type { PlaybookNodeData } from '../types';
import { PORT_COLORS } from '../utils/port-colors';

const ITERATOR_MIN_WIDTH = 360;
const ITERATOR_MIN_HEIGHT = 220;

export function PlaybookIteratorContainerNode({ data, selected }: NodeProps) {
  const node = data as PlaybookNodeData & { childTaskIds?: string[] };
  const { t } = useModuleTranslation('playbook');
  const nodeActions = useContext(NodeDataActionsContext);
  const childCount = node.childTaskIds?.length || 0;
  const isEmpty = childCount === 0;
  const selectedClass = selected
    ? 'border-[#ffcd03] ring-4 ring-inset ring-[#ffcd03]/60 shadow-lg shadow-[#ffcd03]/25'
    : 'border-border';
  const dragActive = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const lastSize = useRef({ width: ITERATOR_MIN_WIDTH, height: ITERATOR_MIN_HEIGHT });
  const pointerIdRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const queueSizeUpdate = useCallback((clientX: number, clientY: number) => {
    const nextWidth = Math.max(ITERATOR_MIN_WIDTH, dragStart.current.width + (clientX - dragStart.current.x));
    const nextHeight = Math.max(ITERATOR_MIN_HEIGHT, dragStart.current.height + (clientY - dragStart.current.y));
    lastSize.current = { width: nextWidth, height: nextHeight };
    if (frameRef.current !== null || typeof window === 'undefined') {
      if (frameRef.current === null) {
        nodeActions?.setIteratorNodeSize?.(node.id, lastSize.current);
      }
      return;
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      nodeActions?.setIteratorNodeSize?.(node.id, lastSize.current);
    });
  }, [node.id, nodeActions]);

  const finishResize = useCallback(() => {
    if (!dragActive.current) return;
    dragActive.current = false;
    pointerIdRef.current = null;
    if (frameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    nodeActions?.setIteratorNodeSize?.(node.id, lastSize.current);
    setIsResizing(false);
    nodeActions?.resizeIteratorNode?.(node.id, lastSize.current);
  }, [node.id, nodeActions]);

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !nodeActions?.setIteratorNodeSize || !nodeActions?.resizeIteratorNode) return;
    dragActive.current = true;
    pointerIdRef.current = event.pointerId;
    setIsResizing(true);
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      width: typeof node.width === 'number' ? node.width : ITERATOR_MIN_WIDTH,
      height: typeof node.height === 'number' ? node.height : ITERATOR_MIN_HEIGHT,
    };
    lastSize.current = {
      width: dragStart.current.width,
      height: dragStart.current.height,
    };
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.stopPropagation();
    event.preventDefault();
  }, [node.height, node.width, nodeActions]);

  const handleResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragActive.current || !nodeActions?.setIteratorNodeSize) return;
    queueSizeUpdate(event.clientX, event.clientY);
    event.stopPropagation();
  }, [nodeActions?.setIteratorNodeSize, queueSizeUpdate]);

  const handleResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragActive.current) return;
    if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
      queueSizeUpdate(event.clientX, event.clientY);
    }
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishResize();
    event.stopPropagation();
  }, [finishResize, queueSizeUpdate]);

  useEffect(() => {
    if (!isResizing || typeof window === 'undefined') {
      return undefined;
    }

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (!dragActive.current) return;
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;
      queueSizeUpdate(event.clientX, event.clientY);
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      if (!dragActive.current) return;
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;
      queueSizeUpdate(event.clientX, event.clientY);
      finishResize();
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [finishResize, isResizing, queueSizeUpdate]);

  return (
    <div className={`relative h-full w-full overflow-visible rounded-xl border-2 border-dashed transition-colors ${selectedClass} ${isEmpty ? 'bg-muted/35' : 'bg-muted/20'} ${isResizing ? 'shadow-xl shadow-primary/30' : ''}`}>
      {(node.inputPorts || []).map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          className="!h-3 !w-3 !border-2 !border-background !bg-primary"
          style={{ top: 80 }}
          aria-label={port.name}
        />
      ))}
      {(node.outputPorts || []).map((port) => (
        <div key={port.id} className="absolute right-0 top-20 z-10 flex -translate-y-1/2 items-center gap-2">
          <div className="rounded-full border bg-background/90 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-sm">
            {port.name}
          </div>
          <Handle
            id={port.id}
            type="source"
            position={Position.Right}
            className="!h-3 !w-3 !border-2 !border-background"
            style={{ top: 0, background: PORT_COLORS[port.artifactKind]?.raw }}
            aria-label={port.name}
          />
        </div>
      ))}
      <div className="flex items-start justify-between gap-3 border-b border-border/80 bg-background/70 px-4 py-2 backdrop-blur-sm">
        <div className="flex min-w-0 items-start gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <RefreshCcw className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{node.title || t('nodeEditor.nodeTypeIterator')}</div>
            <div className="truncate text-[11px] text-muted-foreground">{t('nodeEditor.iteratorOutputPortHint')}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {nodeActions?.repackIteratorChildren ? (
            <button
              type="button"
              className="nodrag nopan inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background/85 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                nodeActions.repackIteratorChildren?.(node.id);
              }}
              aria-label={t('iterator.repackChildren')}
              title={t('iterator.repackChildren')}
            >
              <LayoutGrid className="h-4 w-4" />
              <span>{t('iterator.repackChildren')}</span>
            </button>
          ) : null}
          <Badge variant="outline" className="border-border bg-background/80 text-foreground">
            {node.iteratorConfig?.mode === 'batch' ? t('nodeEditor.iteratorModeBatch') : t('nodeEditor.iteratorModeItem')}
          </Badge>
          <Badge variant="outline" className="border-border bg-background/80 text-foreground">
            {t('iterator.childCount', { count: childCount })}
          </Badge>
        </div>
      </div>
      <div className="pointer-events-none h-[calc(100%-52px)] rounded-b-xl bg-gradient-to-b from-background/10 via-transparent to-background/5 p-3">
        <div className="flex h-full min-h-0 flex-col rounded-lg border border-border/60 bg-background/20 shadow-inner">
          <div className="border-b border-border/60 px-4 py-2">
            <div className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t('nodeEditor.nodeTypeIterator')}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {node.description || t('iterator.dropHint')}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <div className={`w-full rounded-lg border border-dashed px-4 py-5 text-center text-xs ${isEmpty ? 'border-primary/40 bg-background/40 text-muted-foreground' : 'border-border/70 bg-background/10 text-muted-foreground'}`}>
              {isEmpty ? t('iterator.dropHint') : t('iterator.repackChildren')}
            </div>
          </div>
        </div>
      </div>
      {selected && nodeActions?.setIteratorNodeSize && nodeActions?.resizeIteratorNode ? (
        <div
          role="presentation"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          className="nodrag nopan absolute -bottom-2 -right-2 z-20 h-6 w-6 cursor-se-resize rounded-md border border-primary/50 bg-background/95 shadow-md ring-2 ring-background"
          style={{ touchAction: 'none' }}
        />
      ) : null}
    </div>
  );
}
