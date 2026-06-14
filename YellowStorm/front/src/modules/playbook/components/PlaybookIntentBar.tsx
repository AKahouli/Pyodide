import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Clock, FolderOpen, GripVertical, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookIntentClarificationResource, PlaybookIntentDesignResponse, PlaybookIntentSuggestion, PlaybookTask, IntentSuggestionHistoryEntry } from '../types';
import type { PlaybookIntentConstructionStatus } from '../types';
import { PlaybookClarificationResourcePicker } from './PlaybookClarificationResourcePicker';

function releasePointerCaptureSafely(target: HTMLDivElement, pointerId: number) {
  if (typeof target.hasPointerCapture === 'function' && !target.hasPointerCapture(pointerId)) {
    return;
  }

  target.releasePointerCapture?.(pointerId);
}

function setPointerCaptureSafely(target: HTMLDivElement, pointerId: number) {
  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    // Radix/dialog focus handoff can invalidate the pointer before capture completes.
  }
}

interface Props {
  selectedTask: PlaybookTask | null;
  loading: boolean;
  value: string;
  suggestions: PlaybookIntentSuggestion[];
  design?: PlaybookIntentDesignResponse | null;
  error: string;
  history: IntentSuggestionHistoryEntry[];
  autoApply: boolean;
  onValueChange: (value: string) => void;
  onAutoApplyChange: (value: boolean) => void;
  onSubmit: () => void;
  onForceGenerate?: (answerText?: string) => void;
  onApplySuggestion: (suggestion: PlaybookIntentSuggestion) => void;
  onRecordHistory: (suggestion: PlaybookIntentSuggestion, intent: string) => void;
  onApplyHistorySuggestion?: (suggestion: PlaybookIntentSuggestion) => void;
  onBarClick?: () => void;
  onPositionChange?: (offset: { x: number; y: number }) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  constructionStatus?: PlaybookIntentConstructionStatus;
  constructionProgress?: string;
  onCancelConstruction?: () => void;
}

function getConfidenceColor(score: number): string {
  if (score >= 0.8) return 'text-green-600 dark:text-green-400 border-green-500/40 bg-green-50 dark:bg-green-950/30';
  if (score >= 0.5) return 'text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-50 dark:bg-amber-950/30';
  return 'text-red-600 dark:text-red-400 border-red-500/40 bg-red-50 dark:bg-red-950/30';
}

export const PlaybookIntentBar = forwardRef<HTMLDivElement, Readonly<Props>>(function PlaybookIntentBar({
  selectedTask,
  loading,
  value,
  suggestions,
  design,
  error,
  history,
  autoApply,
  onValueChange,
  onAutoApplyChange,
  onSubmit,
  onForceGenerate,
  onApplySuggestion,
  onRecordHistory,
  onApplyHistorySuggestion,
  onBarClick,
  onPositionChange,
  collapsed: collapsedProp,
  onCollapsedChange,
  constructionStatus = 'idle',
  constructionProgress,
  onCancelConstruction,
}: Readonly<Props>, forwardedRef) {
  const { t } = useModuleTranslation('playbook');
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [designStepIndex, setDesignStepIndex] = useState(0);
  const [designAnswers, setDesignAnswers] = useState<Record<string, string>>({});
  const [selectedDesignChoice, setSelectedDesignChoice] = useState('');
  const [selectedDesignResource, setSelectedDesignResource] = useState<PlaybookIntentClarificationResource | null>(null);
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [designAnswer, setDesignAnswer] = useState('');
  const [pendingHistoryEntry, setPendingHistoryEntry] = useState<IntentSuggestionHistoryEntry | null>(null);
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
  const collapsed = collapsedProp ?? uncontrolledCollapsed;
  const designQuestions = design?.status === 'needs_clarification' ? design.questions : [];
  const currentDesignQuestion = designQuestions[Math.min(designStepIndex, Math.max(0, designQuestions.length - 1))] ?? null;
  const isLastDesignQuestion = currentDesignQuestion ? designStepIndex >= designQuestions.length - 1 : true;

  const getResourceAnswer = useCallback((resource: PlaybookIntentClarificationResource) => {
    const workspaceName = resource.workspaceName ? `, workspaceName=${resource.workspaceName}` : '';
    const path = resource.path ? `, path=${resource.path}` : '';
    const mimeType = resource.mimeType ? `, mimeType=${resource.mimeType}` : '';
    return `${resource.name} [kind=${resource.kind}, id=${resource.id}, workspaceId=${resource.workspaceId}${workspaceName}${path}${mimeType}]`;
  }, []);

  const setCollapsed = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(collapsed) : next;
    if (collapsedProp === undefined) {
      setUncontrolledCollapsed(resolved);
    }
    onCollapsedChange?.(resolved);
  }, [collapsed, collapsedProp, onCollapsedChange]);

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

  const handleConfirmHistoryApply = useCallback(() => {
    if (!pendingHistoryEntry) return;
    const intentText = pendingHistoryEntry.intent || pendingHistoryEntry.suggestion.label || '';
    if (intentText) {
      onValueChange(intentText);
    }
    if (onApplyHistorySuggestion) {
      onApplyHistorySuggestion(pendingHistoryEntry.suggestion);
    } else {
      onApplySuggestion(pendingHistoryEntry.suggestion);
    }
    setPendingHistoryEntry(null);
    setHistoryOpen(false);
  }, [pendingHistoryEntry, onApplySuggestion, onApplyHistorySuggestion, onValueChange]);

  const handleSubmit = useCallback(() => {
    submittedIntentRef.current = value.trim();
    setDesignStepIndex(0);
    setDesignAnswers({});
    setSelectedDesignChoice('');
    setSelectedDesignResource(null);
    setDesignAnswer('');
    setHistoryOpen(false);
    setExpandedItems(new Set());
    onSubmit();
  }, [value, onSubmit]);

  const getCapturedRequirements = useCallback((includeCurrent: boolean) => {
    const answers = { ...designAnswers };
    if (includeCurrent && currentDesignQuestion) {
      const currentAnswer = selectedDesignChoice === '__resource__' && selectedDesignResource
        ? getResourceAnswer(selectedDesignResource)
        : selectedDesignChoice === '__custom__' ? designAnswer.trim() : selectedDesignChoice.trim();
      if (currentAnswer) answers[currentDesignQuestion.id] = currentAnswer;
    }

    return designQuestions
      .map((question) => {
        const answer = answers[question.id]?.trim();
        return answer ? `${question.question}: ${answer}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }, [currentDesignQuestion, designAnswer, designAnswers, designQuestions, getResourceAnswer, selectedDesignChoice, selectedDesignResource]);

  const loadDesignAnswer = useCallback((questionId: string | undefined, answers: Record<string, string>) => {
    const question = designQuestions.find((item) => item.id === questionId);
    const answer = questionId ? answers[questionId] || '' : '';
    if (!answer) {
      setSelectedDesignChoice('');
      setSelectedDesignResource(null);
      setDesignAnswer('');
      return;
    }

    if (question?.choices?.includes(answer)) {
      setSelectedDesignChoice(answer);
      setSelectedDesignResource(null);
      setDesignAnswer('');
      return;
    }

    setSelectedDesignChoice('__custom__');
    setSelectedDesignResource(null);
    setDesignAnswer(answer);
  }, [designQuestions]);

  const saveCurrentDesignAnswer = useCallback(() => {
    if (!currentDesignQuestion) return '';
    const answer = selectedDesignChoice === '__resource__' && selectedDesignResource
      ? getResourceAnswer(selectedDesignResource)
      : selectedDesignChoice === '__custom__' ? designAnswer.trim() : selectedDesignChoice.trim();
    if (answer) {
      setDesignAnswers((current) => ({ ...current, [currentDesignQuestion.id]: answer }));
    }
    return answer;
  }, [currentDesignQuestion, designAnswer, getResourceAnswer, selectedDesignChoice, selectedDesignResource]);

  const handleBackDesign = useCallback(() => {
    if (designStepIndex <= 0) return;
    const currentAnswer = saveCurrentDesignAnswer();
    const nextAnswers = currentDesignQuestion && currentAnswer
      ? { ...designAnswers, [currentDesignQuestion.id]: currentAnswer }
      : designAnswers;
    const previousQuestion = designQuestions[designStepIndex - 1];
    setDesignAnswers(nextAnswers);
    setDesignStepIndex((current) => Math.max(0, current - 1));
    loadDesignAnswer(previousQuestion?.id, nextAnswers);
  }, [currentDesignQuestion, designAnswers, designQuestions, designStepIndex, loadDesignAnswer, saveCurrentDesignAnswer]);

  const handleContinueDesign = useCallback(() => {
    const currentAnswer = saveCurrentDesignAnswer();
    if (!currentAnswer) return;
    if (!isLastDesignQuestion) {
      const nextQuestion = designQuestions[designStepIndex + 1];
      const nextAnswers = currentDesignQuestion
        ? { ...designAnswers, [currentDesignQuestion.id]: currentAnswer }
        : designAnswers;
      setDesignStepIndex((current) => current + 1);
      setDesignAnswers(nextAnswers);
      loadDesignAnswer(nextQuestion?.id, nextAnswers);
      return;
    }

    onForceGenerate?.(getCapturedRequirements(true));
    setDesignStepIndex(0);
    setDesignAnswers({});
    setSelectedDesignChoice('');
    setSelectedDesignResource(null);
    setDesignAnswer('');
  }, [currentDesignQuestion, designAnswers, designQuestions, designStepIndex, getCapturedRequirements, isLastDesignQuestion, loadDesignAnswer, onForceGenerate, saveCurrentDesignAnswer]);

  const handleSelectDesignChoice = useCallback((choice: string) => {
    setSelectedDesignChoice(choice);
    if (choice !== '__custom__') {
      setDesignAnswer('');
    }
    if (choice !== '__resource__') {
      setSelectedDesignResource(null);
    }
  }, []);

  const handleSelectDesignResource = useCallback((resource: PlaybookIntentClarificationResource) => {
    setSelectedDesignResource(resource);
    setSelectedDesignChoice('__resource__');
    setDesignAnswer('');
  }, []);

  const handleSkipDesign = useCallback(() => {
    onForceGenerate?.(getCapturedRequirements(true));
  }, [getCapturedRequirements, onForceGenerate]);

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
    const horizontalLimit = Math.max(0, window.innerWidth - rect.width - 24);
    const verticalLimit = Math.max(0, window.innerHeight - rect.height - 24);

    return {
      x: Math.max(0, Math.min(horizontalLimit, nextX)),
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

    setPointerCaptureSafely(event.currentTarget, event.pointerId);
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

    releasePointerCaptureSafely(event.currentTarget, event.pointerId);
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

    releasePointerCaptureSafely(event.currentTarget, event.pointerId);
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
      suggestion.impact.edgesToCreate ? t('intentBar.impact.edgesAdded', { count: suggestion.impact.edgesToCreate }) : '',
      suggestion.impact.edgesToDelete ? t('intentBar.impact.edgesDeleted', { count: suggestion.impact.edgesToDelete }) : '',
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
  const constructionActive = constructionStatus === 'starting' || constructionStatus === 'streaming';
  const canContinueDesign = Boolean(
    selectedDesignChoice
    && (selectedDesignChoice !== '__custom__' || designAnswer.trim().length > 0)
    && (selectedDesignChoice !== '__resource__' || selectedDesignResource)
    && (!isLastDesignQuestion || onForceGenerate),
  );

  const setContainerNode = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (!forwardedRef) return;
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
      return;
    }
    forwardedRef.current = node;
  }, [forwardedRef]);

  useLayoutEffect(() => {
    onPositionChange?.(offset);
  }, [collapsed, offset, onPositionChange]);

  useEffect(() => {
    setDesignStepIndex(0);
    setDesignAnswers({});
    setSelectedDesignChoice('');
    setSelectedDesignResource(null);
    setDesignAnswer('');
  }, [design]);

  return (
    <div
      ref={setContainerNode}
      className="pointer-events-auto absolute left-3 top-3 z-20 w-[min(780px,calc(100%-2rem))]"
      style={{ marginLeft: offset.x, marginTop: offset.y }}
    >
      <div className="max-h-[calc(100vh-1.5rem)] overflow-hidden rounded-2xl border bg-background/95 shadow-xl backdrop-blur">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
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
            </div>
          </Button>
          <div className="flex shrink-0 items-center gap-2 self-center">
            {!collapsed ? (
              <label htmlFor="intent-bar-auto-apply" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch id="intent-bar-auto-apply" checked={autoApply} onCheckedChange={onAutoApplyChange} aria-label={t('intentBar.actions.autoApply')} />
                <span>{t('intentBar.actions.autoApply')}</span>
              </label>
            ) : null}
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
        </div>

        {!collapsed ? (
          <div className="flex min-h-0 max-h-[calc(100vh-7rem)] flex-col gap-3 p-4">
            <div className="flex shrink-0 flex-col gap-2 sm:grid sm:grid-cols-[9fr_2fr] sm:items-start">
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
                rows={1}
                className="min-h-[40px] max-h-44 resize-y"
              />
              <div className="flex shrink-0 items-center gap-1.5 sm:w-full">
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
                <Button
                  type="button"
                  className="h-9 w-28 justify-center"
                  variant={constructionActive ? 'destructive' : 'default'}
                  onClick={constructionActive ? onCancelConstruction : handleSuggestClick}
                  disabled={constructionActive ? !onCancelConstruction : loading || value.trim().length < 3}
                >
                  {constructionActive ? <X className="mr-2 h-4 w-4" /> : loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {constructionActive ? t('intentBar.actions.stop') : t('intentBar.actions.suggest')}
                </Button>
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            {design && !autoApply ? (
              <div className="space-y-3 rounded-xl border bg-muted/30 p-3 text-sm">
                {design.status === 'needs_clarification' ? (
                  <div className="space-y-2">
                    {currentDesignQuestion ? (
                      <div className="space-y-3 rounded-lg border bg-background/70 p-3">
                        <div className="space-y-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t('intentBar.design.step', { current: designStepIndex + 1, total: designQuestions.length })}
                          </p>
                          <p className="font-medium">{currentDesignQuestion.question}</p>
                          {currentDesignQuestion.reason ? <p className="text-xs text-muted-foreground">{currentDesignQuestion.reason}</p> : null}
                        </div>
                        <div className="flex flex-col gap-2">
                          {(currentDesignQuestion.choices ?? []).map((choice, index) => (
                            <Button
                              key={choice}
                              type="button"
                              variant={selectedDesignChoice === choice ? 'default' : 'outline'}
                              className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                              onClick={() => handleSelectDesignChoice(choice)}
                            >
                              <span className="mr-2 shrink-0 text-xs font-semibold opacity-80">{index + 1}.</span>
                              <span>{choice}</span>
                            </Button>
                          ))}
                          {currentDesignQuestion.resourceSelector ? (
                            <Button
                              type="button"
                              variant={selectedDesignChoice === '__resource__' ? 'default' : 'outline'}
                              className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                              onClick={() => setResourcePickerOpen(true)}
                            >
                              <span className="mr-2 shrink-0 text-xs font-semibold opacity-80">{(currentDesignQuestion.choices?.length ?? 0) + 1}.</span>
                              <FolderOpen className="mr-2 h-4 w-4 shrink-0" />
                              <span>{selectedDesignResource ? selectedDesignResource.name : t(`intentBar.design.resource.${currentDesignQuestion.resourceSelector}`)}</span>
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant={selectedDesignChoice === '__custom__' ? 'default' : 'outline'}
                            className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                            onClick={() => handleSelectDesignChoice('__custom__')}
                          >
                            <span className="mr-2 shrink-0 text-xs font-semibold opacity-80">{(currentDesignQuestion.choices?.length ?? 0) + (currentDesignQuestion.resourceSelector ? 2 : 1)}.</span>
                            <span>{t('intentBar.design.other')}</span>
                          </Button>
                        </div>
                        {selectedDesignChoice === '__custom__' ? (
                          <Textarea
                            value={designAnswer}
                            onChange={(event) => setDesignAnswer(event.target.value)}
                            placeholder={t('intentBar.design.answerPlaceholder')}
                            rows={2}
                            className="resize-y"
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={handleBackDesign} disabled={loading || designStepIndex === 0}>
                        {t('intentBar.design.back')}
                      </Button>
                      <Button type="button" size="sm" onClick={handleContinueDesign} disabled={loading || !canContinueDesign}>
                        {isLastDesignQuestion ? t('intentBar.design.generate') : t('intentBar.design.next')}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={handleSkipDesign} disabled={loading || !onForceGenerate}>
                        {t('intentBar.design.skip')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {'brief' in design ? (
                      <div className="space-y-1 text-muted-foreground">
                        <p><span className="font-medium text-foreground">{t('intentBar.design.trigger')}</span> {design.brief.trigger}</p>
                        {design.brief.datasources.length > 0 ? <p><span className="font-medium text-foreground">{t('intentBar.design.datasources')}</span> {design.brief.datasources.join(', ')}</p> : null}
                        {design.brief.steps.length > 0 ? <p><span className="font-medium text-foreground">{t('intentBar.design.steps')}</span> {design.brief.steps.join(' → ')}</p> : null}
                        {design.brief.outputs.length > 0 ? <p><span className="font-medium text-foreground">{t('intentBar.design.outputs')}</span> {design.brief.outputs.join(', ')}</p> : null}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" onClick={() => onForceGenerate?.()} disabled={loading || !onForceGenerate}>
                        {t('intentBar.design.generate')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {constructionActive ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  <span className="truncate">{constructionProgress || t('intentBar.construction.streaming')}</span>
                </span>
                {onCancelConstruction ? (
                  <Button type="button" variant="ghost" size="sm" onClick={onCancelConstruction}>
                    <X className="mr-1 h-4 w-4" />
                    {t('intentBar.construction.cancel')}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {showHistory ? (
              <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
                <p className="px-1 text-xs font-medium text-muted-foreground">{t('intentBar.history.title')}</p>
                <div className="min-h-0 max-h-[20rem] flex-1 overflow-y-auto pr-3">
                  <div className="space-y-2">
                    {history.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          setPendingHistoryEntry(entry);
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
            ) : suggestions.length > 0 && !autoApply ? (
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

      <AlertDialog open={!!pendingHistoryEntry} onOpenChange={(open) => { if (!open) setPendingHistoryEntry(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('intentBar.history.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('intentBar.history.confirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('intentBar.history.confirmCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmHistoryApply}>{t('intentBar.history.confirmApply')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {currentDesignQuestion?.resourceSelector ? (
        <PlaybookClarificationResourcePicker
          open={resourcePickerOpen}
          mode={currentDesignQuestion.resourceSelector}
          onOpenChange={setResourcePickerOpen}
          onSelect={handleSelectDesignResource}
        />
      ) : null}
    </div>
  );
});

PlaybookIntentBar.displayName = 'PlaybookIntentBar';
