import { useState, useRef, useCallback } from 'react';
import { ChevronDown, Clock, GripVertical, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookIntentSuggestion, PlaybookTask, IntentSuggestionHistoryEntry } from '../types';

interface Props {
  selectedTask: PlaybookTask | null;
  loading: boolean;
  value: string;
  suggestions: PlaybookIntentSuggestion[];
  error: string;
  history: IntentSuggestionHistoryEntry[];
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onApplySuggestion: (suggestion: PlaybookIntentSuggestion) => void;
  onRecordHistory: (suggestion: PlaybookIntentSuggestion, intent: string) => void;
  onBarClick?: () => void;
}

function getConfidenceColor(score: number): string {
  if (score >= 0.8) return 'text-green-600 dark:text-green-400 border-green-500/40 bg-green-50 dark:bg-green-950/30';
  if (score >= 0.5) return 'text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-50 dark:bg-amber-950/30';
  return 'text-red-600 dark:text-red-400 border-red-500/40 bg-red-50 dark:bg-red-950/30';
}

export function PlaybookIntentBar({
  selectedTask,
  loading,
  value,
  suggestions,
  error,
  history,
  onValueChange,
  onSubmit,
  onApplySuggestion,
  onRecordHistory,
  onBarClick,
}: Readonly<Props>) {
  const { t } = useModuleTranslation('playbook');
  const [collapsed, setCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const submittedIntentRef = useRef('');
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleApplyAndRecord = useCallback((suggestion: PlaybookIntentSuggestion) => {
    onRecordHistory(suggestion, submittedIntentRef.current || value.trim());
    onApplySuggestion(suggestion);
  }, [onApplySuggestion, onRecordHistory, value]);

  const handleSubmit = useCallback(() => {
    submittedIntentRef.current = value.trim();
    setHistoryOpen(false);
    setExpandedItems(new Set());
    onSubmit();
  }, [value, onSubmit]);

  const handleBarClick = useCallback(() => {
    if (collapsed) {
      setCollapsed(false);
    }
    setHistoryOpen(false);
    onBarClick?.();
  }, [collapsed, onBarClick]);

  const clampOffset = useCallback((nextX: number, nextY: number) => {
    if (typeof window === 'undefined' || !containerRef.current) {
      return { x: nextX, y: nextY };
    }

    const rect = containerRef.current.getBoundingClientRect();
    const horizontalLimit = Math.max(0, (window.innerWidth - rect.width - 32) / 2);
    const verticalLimit = Math.max(0, window.innerHeight - rect.height - 24);

    return {
      x: Math.max(-horizontalLimit, Math.min(horizontalLimit, nextX)),
      y: Math.max(0, Math.min(verticalLimit, nextY)),
    };
  }, []);

  const handleHeaderPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [offset.x, offset.y]);

  const handleHeaderPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.moved && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
      dragState.moved = true;
    }

    const nextOffset = clampOffset(dragState.originX + deltaX, dragState.originY + deltaY);
    setOffset(nextOffset);
  }, [clampOffset]);

  const handleHeaderPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragStateRef.current = null;
    if (!dragState.moved) {
      handleBarClick();
    }
  }, [handleBarClick]);

  const handleHeaderPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragStateRef.current = null;
  }, []);

  const handleSuggestClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    handleSubmit();
  }, [handleSubmit]);

  const getPlanCountLabel = (suggestion: PlaybookIntentSuggestion) => {
    if (suggestion.kind !== 'workflow_plan') {
      return null;
    }

    const counts = [
      suggestion.impact.nodesToCreate ? t('intentBar.impact.added', { count: suggestion.impact.nodesToCreate }) : '',
      suggestion.impact.nodesToUpdate ? t('intentBar.impact.updated', { count: suggestion.impact.nodesToUpdate }) : '',
      suggestion.impact.nodesToDelete ? t('intentBar.impact.deleted', { count: suggestion.impact.nodesToDelete }) : '',
    ].filter(Boolean);

    return counts.length ? counts.join(' · ') : t('intentBar.impact.noStructuralChange');
  };

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return t('intentBar.history.justNow');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t('intentBar.history.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('intentBar.history.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    return t('intentBar.history.daysAgo', { count: days });
  };

  const showHistory = historyOpen && history.length > 0;

  return (
    <div
      ref={containerRef}
      className="pointer-events-auto absolute left-1/2 top-3 z-20 w-[min(780px,calc(100%-2rem))] -translate-x-1/2"
      style={{ marginLeft: offset.x, marginTop: offset.y }}
    >
      <div className="max-h-[calc(100vh-1.5rem)] overflow-hidden rounded-2xl border bg-background/95 shadow-xl backdrop-blur">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div
            data-testid="intent-bar-drag-handle"
            className="flex shrink-0 cursor-grab select-none items-center self-stretch active:cursor-grabbing"
            onPointerDown={handleHeaderPointerDown}
            onPointerMove={handleHeaderPointerMove}
            onPointerUp={handleHeaderPointerUp}
            onPointerCancel={handleHeaderPointerCancel}
            aria-hidden="true"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
          <Button
            type="button"
            variant="ghost"
            className="min-w-0 flex-1 justify-start px-0 text-left hover:bg-transparent"
            aria-label={t('intentBar.title')}
            onClick={handleBarClick}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4" />
                <span>{t('intentBar.title')}</span>
                {selectedTask ? <Badge variant="secondary" className="max-w-52 truncate">{selectedTask.title}</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedTask ? t('intentBar.selectedHint') : t('intentBar.canvasHint')}
              </p>
            </div>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={collapsed ? t('intentBar.actions.expand') : t('intentBar.actions.collapse')}
            onClick={(e) => { e.stopPropagation(); setCollapsed((current) => !current); }}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed ? '' : 'rotate-180')} />
          </Button>
        </div>

        {!collapsed ? (
          <div className="flex min-h-0 max-h-[calc(100vh-7rem)] flex-col gap-3 p-4">
            <div className="shrink-0 space-y-2">
              <Textarea
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                onFocus={handleBarClick}
                placeholder={selectedTask ? t('intentBar.selectedPlaceholder', { title: selectedTask.title }) : t('intentBar.placeholder')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmit();
                  }
                }}
                rows={2}
                className="min-h-[52px] max-h-44 resize-y"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant={historyOpen ? 'secondary' : 'outline'}
                  size="icon"
                  disabled={history.length === 0}
                  title={t('intentBar.history.title')}
                  aria-label={t('intentBar.history.title')}
                  aria-expanded={historyOpen}
                  onClick={(e) => { e.stopPropagation(); setHistoryOpen((current) => !current); }}
                >
                  <Clock className="h-4 w-4" />
                </Button>
                <Button type="button" onClick={handleSuggestClick} disabled={loading || value.trim().length < 3}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('intentBar.actions.suggest')}
                </Button>
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            {showHistory ? (
              <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
                <p className="px-1 text-xs font-medium text-muted-foreground">{t('intentBar.history.title')}</p>
                <div className="min-h-0 flex-1 overflow-y-auto pr-3">
                  <div className="space-y-2">
                    {history.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          onApplySuggestion(entry.suggestion);
                          setHistoryOpen(false);
                        }}
                        className="w-full rounded-xl border bg-muted/30 p-3 text-left transition hover:border-primary/50 hover:bg-muted/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="text-sm font-medium">{entry.suggestion.label || t('intentBar.fallbackLabel')}</div>
                            {entry.suggestion.summary ? <p className="text-sm text-muted-foreground">{entry.suggestion.summary}</p> : null}
                            {entry.suggestion.kind === 'workflow_plan' && entry.suggestion.impact.businessOutcome ? (
                              <p className="text-xs font-medium text-foreground">{entry.suggestion.impact.businessOutcome}</p>
                            ) : null}
                            {entry.intent ? (
                              <p className="text-xs text-muted-foreground">{entry.intent}</p>
                            ) : null}
                            {entry.suggestion.kind === 'workflow_plan' ? (
                              <div className="flex flex-wrap gap-1 pt-1">
                                <Badge variant="secondary">{t('intentBar.planBadge')}</Badge>
                                <Badge variant="outline">{getPlanCountLabel(entry.suggestion)}</Badge>
                     </div>
                            ) : null}
                          </div>
                          <Badge variant="outline">{formatTimeAgo(entry.appliedAt)}</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : suggestions.length > 0 ? (
              <div className="min-h-0 max-h-[20rem] flex-1 overflow-y-auto pr-3">
                <div className="space-y-2">
                  {suggestions.map((suggestion) => {
                    const isExpanded = expandedItems.has(suggestion.id);
                    const hasFullDetails = suggestion.summary && suggestion.summary.length > 80;
                    return (
                    <div
                      key={suggestion.id}
                      className="rounded-xl border bg-muted/30 p-3 text-left transition hover:border-primary/50 hover:bg-muted/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="text-sm font-medium truncate">{suggestion.label || t('intentBar.fallbackLabel')}</div>
                          {suggestion.summary ? (
                            <div>
                              <p className={cn('text-sm text-muted-foreground', !isExpanded && 'line-clamp-2')}>{suggestion.summary}</p>
                              {hasFullDetails ? (
                                <Button
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-xs font-medium"
                                  onClick={() => toggleExpanded(suggestion.id)}
                                >
                                  {isExpanded ? t('intentBar.showLess') : t('intentBar.showMore')}
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                          {isExpanded && suggestion.kind === 'workflow_plan' && suggestion.impact.businessOutcome ? (
                            <p className="text-xs font-medium text-foreground">{suggestion.impact.businessOutcome}</p>
                          ) : null}
                          {isExpanded && suggestion.reason ? <p className="text-xs text-muted-foreground">{suggestion.reason}</p> : null}
                          {suggestion.kind === 'workflow_plan' ? (
                            <div className="flex flex-wrap gap-1 pt-1">
                              <Badge variant="secondary">{t('intentBar.planBadge')}</Badge>
                              <Badge variant="outline">{getPlanCountLabel(suggestion)}</Badge>
                            </div>
                          ) : null}
                          <div className="pt-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleApplyAndRecord(suggestion)}
                            >
                              {t('intentBar.actions.apply')}
                            </Button>
                          </div>
                        </div>
                        <Badge variant="outline" className={cn('shrink-0 text-xs font-mono', getConfidenceColor(suggestion.confidence))}>
                          {Math.round(suggestion.confidence * 100)}%
                        </Badge>
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>
            ) : value.trim().length > 0 && !loading ? (
              <p className="px-1 text-sm text-muted-foreground">{t('intentBar.emptyState')}</p>
            ) : null}

          </div>
        ) : null}
      </div>
    </div>
  );
}
