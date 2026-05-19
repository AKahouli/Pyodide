import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { ChevronDown, GripVertical, LayoutGrid, Plus, Redo2, Undo2, Cable, FolderOpen, PanelLeftClose, PanelLeftOpen, Loader2, Download, Wand2, Trash2, GitBranch, Hand, DatabaseZap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';

import { PORT_COLORS } from '../utils/port-colors';
import { usePlaybookStore } from '../store';
import type { InterruptType, TaskTemplate } from '../types';

interface Props {
  containerRef: RefObject<HTMLElement>;
  onAddStep: () => void;
  onAddRouterNode?: () => void;
  onAddHumanApprovalNode?: () => void;
  onAddStepFromTemplate: (template: TaskTemplate) => void;
  onAutoLayout: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleConnectors: () => void;
  onToggleExplorer: () => void;
  connectorsOpen: boolean;
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
  waitingForHumanInput?: boolean;
  interruptType?: InterruptType | null;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

type Position = { x: number; y: number };

const DEFAULT_POSITION: Position = { x: 16, y: 16 };
const STORAGE_KEY = 'playbook-canvas-floating-toolbar-position';

export function PlaybookCanvasFloatingToolbar({
  containerRef,
  onAddStep,
  onAddRouterNode,
  onAddHumanApprovalNode,
  onAddStepFromTemplate,
  onAutoLayout,
  onUndo,
  onRedo,
  onToggleConnectors,
  onToggleExplorer,
  connectorsOpen,
  explorerOpen,
  canUndo,
  canRedo,
  disabled = false,
  onDownloadAllResults,
  canDownloadAllResults = false,
  onToggleDesigner,
  designerOpen = false,
  onToggleDataBindings,
  dataBindingsVisible = true,
  onRemoveAllTasks,
  taskCount = 0,
  waitingForHumanInput = false,
  interruptType = null,
  collapsed: collapsedProp,
  onCollapsedChange,
}: Props) {
  const { t } = useModuleTranslation('playbook');
  const flowNodeTemplates = usePlaybookStore((s) => s.flowNodeTemplates);
  const flowNodeTemplatesLoading = usePlaybookStore((s) => s.flowNodeTemplatesLoading);
  const fetchFlowNodeTemplates = usePlaybookStore((s) => s.fetchFlowNodeTemplates);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragOffsetRef = useRef<Position>({ x: 0, y: 0 });
  const positionRef = useRef<Position>(DEFAULT_POSITION);
  const [position, setPosition] = useState<Position>(DEFAULT_POSITION);
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

  useEffect(() => {
    void fetchFlowNodeTemplates();
  }, [fetchFlowNodeTemplates]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Partial<Position>;
      const next = {
        x: Number.isFinite(parsed.x) ? Number(parsed.x) : DEFAULT_POSITION.x,
        y: Number.isFinite(parsed.y) ? Number(parsed.y) : DEFAULT_POSITION.y,
      };
      positionRef.current = next;
      setPosition(next);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const clampPosition = (next: Position): Position => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const toolbarRect = toolbarRef.current?.getBoundingClientRect();
    if (!containerRect || !toolbarRect) return next;

    const maxX = Math.max(DEFAULT_POSITION.x, containerRect.width - toolbarRect.width - 16);
    const maxY = Math.max(DEFAULT_POSITION.y, containerRect.height - toolbarRect.height - 16);

    return {
      x: Math.min(Math.max(DEFAULT_POSITION.x, next.x), maxX),
      y: Math.min(Math.max(DEFAULT_POSITION.y, next.y), maxY),
    };
  };

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
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positionRef.current));
    }
    dragPointerIdRef.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
  };

  useEffect(() => stopDragging, []);

  useEffect(() => {
    const syncPosition = () => {
      setPosition((current) => clampPosition(current));
    };

    window.addEventListener('resize', syncPosition);
    syncPosition();
    return () => window.removeEventListener('resize', syncPosition);
  }, []);

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
      key: 'removeAll',
      label: t('toolbar.removeAllTasks'),
      icon: Trash2,
      onClick: onRemoveAllTasks,
      disabled: taskCount === 0,
      hidden: !onRemoveAllTasks,
    },
  ];

  return (
    <TooltipProvider delayDuration={250}>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onAddStep}
                    disabled={disabled}
                    className={cn('h-9', collapsed ? 'rounded-r-none border-r-0 px-2' : 'w-full rounded-b-none px-3 justify-start border-b-0')}
                    aria-label={collapsed ? t('toolbar.addBlankStep') : undefined}
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="ml-2 truncate">{t('toolbar.addBlankStep')}</span>}
                  </Button>
                </TooltipTrigger>
                {collapsed && <TooltipContent side="right">{t('toolbar.addStep')}</TooltipContent>}
              </Tooltip>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    className={cn('h-9', collapsed ? 'rounded-l-none px-1.5' : 'w-full rounded-t-none px-3 justify-between')}
                    aria-label={t('toolbar.tasks')}
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
              const button = (
                <Button
                  key={action.key}
                  type="button"
                  variant={action.active ? 'default' : 'outline'}
                  size="sm"
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className={cn('h-9', collapsed ? 'w-9 px-0' : 'w-full justify-start px-3')}
                  aria-label={collapsed ? action.label : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="ml-2 truncate">{action.label}</span>}
                </Button>
              );

              if (!collapsed) return button;

              return (
                <Tooltip key={action.key}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent side="right">{action.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
