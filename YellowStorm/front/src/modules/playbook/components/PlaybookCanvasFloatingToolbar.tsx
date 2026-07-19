import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { ChevronDown, GripVertical, LayoutGrid, Plus, Redo2, Undo2, Cable, FolderOpen, PanelLeftClose, PanelLeftOpen, Loader2, Download, Wand2, Trash2, GitBranch, Hand, DatabaseZap, Copy, Scissors, ClipboardPaste, Sparkles, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';

import { PORT_COLORS } from '../utils/port-colors';
import { usePlaybookStore } from '../store';
import type { InterruptType, TaskTemplate } from '../types';

interface Props {
  containerRef: RefObject<HTMLElement>;
  avoidRectRef?: RefObject<HTMLElement>;
  onAddStep: () => void;
  onAddRouterNode?: () => void;
  onAddHumanApprovalNode?: () => void;
  onAddStepFromTemplate: (template: TaskTemplate) => void;
  onAutoLayout: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleConnectors: () => void;
  onToggleSkills: () => void;
  onToggleExplorer: () => void;
  connectorsOpen: boolean;
  skillsOpen: boolean;
  explorerOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  disabled?: boolean;
  onDownloadAllResults?: () => void;
  canDownloadAllResults?: boolean;
  onToggleDesigner?: () => void;
  designerOpen?: boolean;
  onToggleDataBindings?: () => void;
  dataBindingsVisible?: boolean;
  onRemoveAllTasks?: () => void;
  taskCount?: number;
  onCopySelection?: () => void;
  onCutSelection?: () => void;
  onPasteClipboard?: () => void;
  hasSelection?: boolean;
  waitingForHumanInput?: boolean;
  interruptType?: InterruptType | null;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  minTopOffset?: number;
  minLeftOffset?: number;
  avoidRectPadding?: number;
  deepSearch?: boolean;
  onToggleDeepSearch?: () => void;
}

export interface PlaybookCanvasFloatingToolbarHandle {
  reclampPosition: () => void;
}

type Position = { x: number; y: number };

const DEFAULT_POSITION: Position = { x: 16, y: 16 };
const VIEWPORT_PADDING = 16;

function positionsMatch(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

export const PlaybookCanvasFloatingToolbar = forwardRef<PlaybookCanvasFloatingToolbarHandle, Props>(function PlaybookCanvasFloatingToolbar({
  containerRef,
  avoidRectRef,
  onAddStep,
  onAddRouterNode,
  onAddHumanApprovalNode,
  onAddStepFromTemplate,
  onAutoLayout,
  onUndo,
  onRedo,
  onToggleConnectors,
  onToggleSkills,
  onToggleExplorer,
  connectorsOpen,
  skillsOpen,
  explorerOpen,
  canUndo,
  canRedo,
  disabled = false,
  onDownloadAllResults,
  canDownloadAllResults = false,
  onToggleDesigner,
  designerOpen = false,
  onToggleDataBindings,
  dataBindingsVisible = false,
  onRemoveAllTasks,
  taskCount = 0,
  onCopySelection,
  onCutSelection,
  onPasteClipboard,
  hasSelection = false,
  waitingForHumanInput = false,
  interruptType = null,
  collapsed: collapsedProp,
  onCollapsedChange,
  minTopOffset = 0,
  minLeftOffset = DEFAULT_POSITION.x,
  avoidRectPadding = 12,
  deepSearch = false,
  onToggleDeepSearch,
}: Props, ref) {
  const { t } = useModuleTranslation('playbook');
  const flowNodeTemplates = usePlaybookStore((s) => s.flowNodeTemplates);
  const flowNodeTemplatesLoading = usePlaybookStore((s) => s.flowNodeTemplatesLoading);
  const fetchFlowNodeTemplates = usePlaybookStore((s) => s.fetchFlowNodeTemplates);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragOffsetRef = useRef<Position>({ x: 0, y: 0 });
  const initialPosition = {
    x: Math.max(DEFAULT_POSITION.x, minLeftOffset),
    y: Math.max(DEFAULT_POSITION.y, Math.max(0, minTopOffset)),
  };
  const positionRef = useRef<Position>(initialPosition);
  const [position, setPosition] = useState<Position>(initialPosition);
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(false);
  const titleId = useId();
  const collapsed = collapsedProp ?? uncontrolledCollapsed;

  const setCollapsed = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(collapsed) : next;
    if (collapsedProp === undefined) {
      setUncontrolledCollapsed(resolved);
    }
    onCollapsedChange?.(resolved);
  }, [collapsed, collapsedProp, onCollapsedChange]);

  const getDefaultPosition = useCallback((): Position => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const toolbarRect = toolbarRef.current?.getBoundingClientRect();

    if (!containerRect || !toolbarRect) {
      return {
        x: Math.max(DEFAULT_POSITION.x, minLeftOffset),
        y: Math.max(0, minTopOffset),
      };
    }

    const avoidRect = avoidRectRef?.current?.getBoundingClientRect();
    let x = Math.max(DEFAULT_POSITION.x, minLeftOffset);
    let y = Math.max(0, minTopOffset);

    if (avoidRect) {
      const avoidRightInContainer = avoidRect.right - containerRect.left;
      const avoidTopInContainer = avoidRect.top - containerRect.top;
      x = Math.max(x, avoidRightInContainer + avoidRectPadding);
      y = Math.max(y, avoidTopInContainer);
    }

    return { x, y };
  }, [avoidRectPadding, avoidRectRef, containerRef, minLeftOffset, minTopOffset]);

  const clampPosition = useCallback((next: Position): Position => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const toolbarRect = toolbarRef.current?.getBoundingClientRect();
    if (!containerRect || !toolbarRect) return next;

    const minX = Math.max(DEFAULT_POSITION.x, minLeftOffset);
    const maxX = Math.max(minX, containerRect.width - toolbarRect.width - VIEWPORT_PADDING);
    const minY = Math.max(0, minTopOffset);
    const maxY = Math.max(minY, containerRect.height - toolbarRect.height - VIEWPORT_PADDING);

    const clampX = (value: number) => Math.min(Math.max(minX, value), maxX);
    const clampY = (value: number) => Math.min(Math.max(minY, value), maxY);
    const desired = {
      x: clampX(next.x),
      y: clampY(next.y),
    };

    const avoidRect = avoidRectRef?.current?.getBoundingClientRect();
    if (!avoidRect) {
      return desired;
    }

    const avoidLeft = avoidRect.left - containerRect.left - avoidRectPadding;
    const avoidRight = avoidRect.right - containerRect.left + avoidRectPadding;
    const avoidTop = avoidRect.top - containerRect.top - avoidRectPadding;
    const avoidBottom = avoidRect.bottom - containerRect.top + avoidRectPadding;

    const overlapsAvoidRect = (candidate: Position) => candidate.x < avoidRight
      && candidate.x + toolbarRect.width > avoidLeft
      && candidate.y < avoidBottom
      && candidate.y + toolbarRect.height > avoidTop;

    if (!overlapsAvoidRect(desired)) {
      return desired;
    }

    const candidates = [
      { x: avoidLeft - toolbarRect.width, y: desired.y },
      { x: avoidRight, y: desired.y },
      { x: desired.x, y: avoidTop - toolbarRect.height },
      { x: desired.x, y: avoidBottom },
    ]
      .map((candidate) => ({
        x: clampX(candidate.x),
        y: clampY(candidate.y),
      }))
      .filter((candidate, index, all) => all.findIndex((other) => other.x === candidate.x && other.y === candidate.y) === index)
      .filter((candidate) => !overlapsAvoidRect(candidate));

    if (candidates.length === 0) {
      return desired;
    }

    return candidates.reduce((best, candidate) => {
      const bestDistance = Math.abs(best.x - desired.x) + Math.abs(best.y - desired.y);
      const candidateDistance = Math.abs(candidate.x - desired.x) + Math.abs(candidate.y - desired.y);
      return candidateDistance < bestDistance ? candidate : best;
    });
  }, [avoidRectPadding, avoidRectRef, containerRef, minLeftOffset, minTopOffset]);

  const reclampPosition = useCallback(() => {
    setPosition((current) => {
      const next = clampPosition(current);
      if (positionsMatch(current, next)) {
        return current;
      }
      positionRef.current = next;
      return next;
    });
  }, [clampPosition]);

  useImperativeHandle(ref, () => ({
    reclampPosition,
  }), [reclampPosition]);

  useEffect(() => {
    void fetchFlowNodeTemplates();
  }, [fetchFlowNodeTemplates]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const handlePointerMove = (event: PointerEvent) => {
    if (dragPointerIdRef.current !== event.pointerId) return;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const next = clampPosition({
      x: event.clientX - containerRect.left - dragOffsetRef.current.x,
      y: event.clientY - containerRect.top - dragOffsetRef.current.y,
    });
    setPosition(next);
  };

  const stopDragging = () => {
    dragPointerIdRef.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
  };

  useEffect(() => stopDragging, []);

  useLayoutEffect(() => {
    const next = clampPosition(getDefaultPosition());
    if (!positionsMatch(positionRef.current, next)) {
      positionRef.current = next;
      setPosition(next);
    }
  }, [clampPosition, getDefaultPosition]);

  useLayoutEffect(() => {
    const syncPosition = () => {
      const next = clampPosition(getDefaultPosition());
      if (!positionsMatch(positionRef.current, next)) {
        positionRef.current = next;
        setPosition(next);
      }
    };

    window.addEventListener('resize', syncPosition);
    syncPosition();
    return () => window.removeEventListener('resize', syncPosition);
  }, [clampPosition, getDefaultPosition]);

  useLayoutEffect(() => {
    reclampPosition();
  }, [collapsed, reclampPosition]);

  const startDragging = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const containerRect = containerRef.current?.getBoundingClientRect();
    const toolbarRect = toolbarRef.current?.getBoundingClientRect();
    if (!containerRect || !toolbarRect) return;

    dragPointerIdRef.current = event.pointerId;
    dragOffsetRef.current = {
      x: event.clientX - toolbarRect.left,
      y: event.clientY - toolbarRect.top,
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
  };

  const designerLabel = waitingForHumanInput
    ? interruptType === 'review_request'
      ? t('interrupt.reviewTitle')
      : interruptType === 'clarification'
        ? t('interrupt.clarificationTitle')
        : t('interrupt.approvalTitle')
    : t('toolbar.designer');

  const actionButtons = [
    {
      key: 'undo',
      label: t('toolbar.undo'),
      icon: Undo2,
      onClick: onUndo,
      disabled: disabled || !canUndo,
    },
    {
      key: 'redo',
      label: t('toolbar.redo'),
      icon: Redo2,
      onClick: onRedo,
      disabled: disabled || !canRedo,
    },
    {
      key: 'layout',
      label: t('toolbar.autoLayout'),
      icon: LayoutGrid,
      onClick: onAutoLayout,
      disabled,
    },
    {
      key: 'explorer',
      label: explorerOpen ? t('toolbar.hideExplorer') : t('toolbar.showExplorer'),
      icon: FolderOpen,
      onClick: onToggleExplorer,
      disabled,
      active: explorerOpen,
    },
    {
      key: 'connectors',
      label: connectorsOpen ? t('toolbar.hideConnectors') : t('toolbar.showConnectors'),
      icon: Cable,
      onClick: onToggleConnectors,
      disabled,
      active: connectorsOpen,
    },
    {
      key: 'skills',
      label: skillsOpen ? t('toolbar.hideSkills') : t('toolbar.showSkills'),
      icon: Sparkles,
      onClick: onToggleSkills,
      disabled,
      active: skillsOpen,
    },
    {
      key: 'bindings',
      label: dataBindingsVisible ? t('toolbar.hideDataBindings') : t('toolbar.showDataBindings'),
      icon: DatabaseZap,
      onClick: onToggleDataBindings,
      disabled,
      active: dataBindingsVisible,
      hidden: !onToggleDataBindings,
    },
    {
      key: 'download',
      label: t('execution.downloadAllResults'),
      icon: Download,
      onClick: onDownloadAllResults,
      disabled: !canDownloadAllResults,
      hidden: !onDownloadAllResults,
    },
    {
      key: 'designer',
      label: designerLabel,
      icon: Wand2,
      onClick: onToggleDesigner,
      disabled: false,
      active: designerOpen,
      hidden: !onToggleDesigner,
    },
    {
      key: 'deepSearch',
      label: deepSearch ? t('floatingToolbar.deepSearchDisable') : t('floatingToolbar.deepSearchEnable'),
      icon: Search,
      onClick: onToggleDeepSearch,
      disabled,
      active: deepSearch,
      activeClassName: deepSearch
        ? 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/20 border-amber-500/40'
        : '',
      hidden: !onToggleDeepSearch,
    },
    {
      key: 'removeAll',
      label: t('toolbar.removeAllTasks'),
      icon: Trash2,
      onClick: onRemoveAllTasks,
      disabled: disabled || taskCount === 0,
      hidden: !onRemoveAllTasks,
    },
    {
      key: 'copy',
      label: t('toolbar.copy'),
      icon: Copy,
      onClick: onCopySelection,
      disabled: disabled || !hasSelection,
      hidden: !onCopySelection,
    },
    {
      key: 'cut',
      label: t('toolbar.cut'),
      icon: Scissors,
      onClick: onCutSelection,
      disabled: disabled || !hasSelection,
      hidden: !onCutSelection,
    },
    {
      key: 'paste',
      label: t('toolbar.paste'),
      icon: ClipboardPaste,
      onClick: onPasteClipboard,
      disabled,
      hidden: !onPasteClipboard,
    },
  ];

  return (
    <div
      ref={toolbarRef}
      className="pointer-events-auto absolute z-20"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className={cn(
          'flex rounded-xl border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80',
          collapsed ? 'items-center px-2 py-2' : 'flex-col p-2',
        )}
        role="toolbar"
        aria-orientation={collapsed ? 'horizontal' : 'vertical'}
        aria-labelledby={titleId}
      >
        <div className={cn('flex items-center gap-1', collapsed ? 'pr-1' : 'mb-2 justify-between')}>
          <span id={titleId} className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('toolbar.canvasTools')}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 cursor-grab active:cursor-grabbing"
              onPointerDown={startDragging}
              aria-label={t('toolbar.moveCanvasToolbar')}
              title={t('toolbar.moveCanvasToolbar')}
            >
              <GripVertical className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? t('toolbar.expandCanvasToolbar') : t('toolbar.collapseCanvasToolbar')}
              title={collapsed ? t('toolbar.expandCanvasToolbar') : t('toolbar.collapseCanvasToolbar')}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className={cn('flex gap-1', collapsed ? 'flex-row items-center' : 'flex-col')}>
          <div className={cn('flex', collapsed ? '' : 'w-full flex-col')}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAddStep}
              disabled={disabled}
              className={cn('h-9', collapsed ? 'rounded-r-none border-r-0 px-2' : 'w-full rounded-b-none px-3 justify-start border-b-0')}
              aria-label={collapsed ? t('toolbar.addBlankStep') : undefined}
              title={collapsed ? t('toolbar.addBlankStep') : undefined}
            >
              <Plus className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="ml-2 truncate">{t('toolbar.addBlankStep')}</span>}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  className={cn('h-9', collapsed ? 'rounded-l-none px-1.5' : 'w-full rounded-t-none px-3 justify-between')}
                  aria-label={t('toolbar.tasks')}
                  title={collapsed ? t('toolbar.tasks') : undefined}
                >
                  {!collapsed && <span className="text-xs text-muted-foreground">{t('toolbar.tasks')}</span>}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom" className="w-56">
                <DropdownMenuItem onClick={onAddStep}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('toolbar.addBlankStep')}
                </DropdownMenuItem>
                {onAddRouterNode && (
                  <DropdownMenuItem onClick={onAddRouterNode}>
                    <GitBranch className="mr-2 h-4 w-4 text-muted-foreground" />
                    {t('toolbar.addRouterNode')}
                  </DropdownMenuItem>
                )}
                {onAddHumanApprovalNode && (
                  <DropdownMenuItem onClick={onAddHumanApprovalNode}>
                    <Hand className="mr-2 h-4 w-4 text-muted-foreground" />
                    {t('toolbar.addHumanApprovalNode')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {flowNodeTemplatesLoading ? (
                  <DropdownMenuItem disabled>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('common.loading')}
                  </DropdownMenuItem>
                ) : flowNodeTemplates.length === 0 ? (
                  <DropdownMenuItem disabled>{t('toolbar.noTemplatesAvailable')}</DropdownMenuItem>
                ) : (
                  flowNodeTemplates.map((template) => {
                    const KindIcon = PORT_COLORS[template.inputPorts[0]?.artifactKind || 'text'].icon;
                    return (
                      <DropdownMenuItem key={template.id} onClick={() => onAddStepFromTemplate(template)}>
                        <KindIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                        {template.title}
                      </DropdownMenuItem>
                    );
                  })
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {actionButtons.filter((a) => !a.hidden).map((action) => {
            const Icon = action.icon;
            const useCustomActive = Boolean(action.activeClassName);
            return (
              <Button
                key={action.key}
                type="button"
                variant={useCustomActive ? 'outline' : (action.active ? 'default' : 'outline')}
                size="sm"
                onClick={action.onClick}
                disabled={action.disabled}
                className={cn(
                  'h-9',
                  collapsed ? 'w-9 px-0' : 'w-full justify-start px-3',
                  useCustomActive && action.active ? action.activeClassName : '',
                )}
                aria-label={collapsed ? action.label : undefined}
                title={collapsed ? action.label : undefined}
                aria-pressed={action.active ? 'true' : undefined}
                data-playbook-designer-trigger={action.key === 'designer' ? true : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="ml-2 truncate">{action.label}</span>}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
