import { useState, useRef, useCallback } from 'react';
import { ChevronDown, Clock, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookIntentSuggestion, PlaybookTask, IntentSuggestionHistoryEntry } from '../types';

interface Props {
  playbookId: string;
  playbookName: string;
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
}: Readonly<Props>) {
  const { t } = useModuleTranslation('playbook');
  const [collapsed, setCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const submittedIntentRef = useRef('');

  const handleApplyAndRecord = useCallback((suggestion: PlaybookIntentSuggestion) => {
    onRecordHistory(suggestion, submittedIntentRef.current || value.trim());
    onApplySuggestion(suggestion);
  }, [onApplySuggestion, onRecordHistory, value]);

  const handleSubmit = useCallback(() => {
    submittedIntentRef.current = value.trim();
    setHistoryOpen(false);
    onSubmit();
  }, [value, onSubmit]);

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
    <div className="pointer-events-auto absolute left-1/2 top-3 z-20 w-[min(780px,calc(100%-2rem))] -translate-x-1/2">
      <div className="rounded-2xl border bg-background/95 shadow-xl backdrop-blur">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
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
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setCollapsed((current) => !current)}>
            <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed ? '' : 'rotate-180')} />
          </Button>
        </div>

        {!collapsed ? (
          <div className="space-y-3 p-4">
            <div className="space-y-2">
              <Textarea
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder={selectedTask ? t('intentBar.selectedPlaceholder', { title: selectedTask.title }) : t('intentBar.placeholder')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmit();
                  }
                }}
                rows={2}
                className="min-h-[52px] max-h-32 resize-none"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant={historyOpen ? 'secondary' : 'outline'}
                  size="icon"
                  disabled={history.length === 0}
                  title={t('intentBar.history.title')}
                  aria-label={t('intentBar.history.title')}
                  aria-expanded={historyOpen}
                  onClick={() => setHistoryOpen((current) => !current)}
                >
                  <Clock className="h-4 w-4" />
                </Button>
                <Button onClick={handleSubmit} disabled={loading || value.trim().length < 3}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('intentBar.actions.suggest')}
                </Button>
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            {showHistory ? (
              <div className="space-y-1.5">
                <p className="px-1 text-xs font-medium text-muted-foreground">{t('intentBar.history.title')}</p>
                <ScrollArea className="max-h-96">
                  <div className="space-y-2 pr-3">
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
                </ScrollArea>
              </div>
            ) : suggestions.length > 0 ? (
              <ScrollArea className="max-h-96">
                <div className="space-y-2 pr-3">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onClick={() => handleApplyAndRecord(suggestion)}
                      className="w-full rounded-xl border bg-muted/30 p-3 text-left transition hover:border-primary/50 hover:bg-muted/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm font-medium">{suggestion.label || t('intentBar.fallbackLabel')}</div>
                          {suggestion.summary ? <p className="text-sm text-muted-foreground">{suggestion.summary}</p> : null}
                          {suggestion.kind === 'workflow_plan' && suggestion.impact.businessOutcome ? (
                            <p className="text-xs font-medium text-foreground">{suggestion.impact.businessOutcome}</p>
                          ) : null}
                          {suggestion.reason ? <p className="text-xs text-muted-foreground">{suggestion.reason}</p> : null}
                          {suggestion.kind === 'workflow_plan' ? (
                            <div className="flex flex-wrap gap-1 pt-1">
                              <Badge variant="secondary">{t('intentBar.planBadge')}</Badge>
                              <Badge variant="outline">{getPlanCountLabel(suggestion)}</Badge>
                            </div>
                          ) : null}
                        </div>
                        <Badge variant="outline">{Math.round(suggestion.confidence * 100)}%</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            ) : value.trim().length > 0 && !loading ? (
              <p className="px-1 text-sm text-muted-foreground">{t('intentBar.emptyState')}</p>
            ) : null}

          </div>
        ) : null}
      </div>
    </div>
  );
}
