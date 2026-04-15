import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, GitCompareArrows } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { usePlaybookStore, useCurrentPlaybook, useCurrentPlaybookLoading, useExecutionHistory, useExecutionsLoading } from '../store';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';
import { useModuleTranslation } from '@/modules/localization';
import { formatPlaybookDateTime } from '../utils/formatPlaybookDateTime';

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function PlaybookExecutionListPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useModuleTranslation('playbook');

  const playbook = useCurrentPlaybook();
  const playbookLoading = useCurrentPlaybookLoading();
  const executions = useExecutionHistory();
  const executionsLoading = useExecutionsLoading();
  const fetchPlaybook = usePlaybookStore((s) => s.fetchPlaybook);
  const fetchExecutions = usePlaybookStore((s) => s.fetchExecutions);

  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (id) {
      fetchPlaybook(id);
      fetchExecutions(id);
    }
  }, [id, fetchPlaybook, fetchExecutions]);

  const handleToggleCompareMode = useCallback(() => {
    setCompareMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const handleToggleSelect = useCallback((execId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(execId)) {
        next.delete(execId);
      } else {
        if (next.size >= 2) return prev; // max 2
        next.add(execId);
      }
      return next;
    });
  }, []);

  const handleCompare = useCallback(() => {
    if (selectedIds.size !== 2) return;
    const [a, b] = Array.from(selectedIds);
    navigate(`/playbooks/${id}/executions/compare?a=${a}&b=${b}`);
  }, [selectedIds, id, navigate]);

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/playbooks/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold flex-1">
          {playbook?.name || t('execution.playbook')} — {t('toolbar.executions')}
        </h1>
        {executions.length >= 2 && (
          <div className="flex items-center gap-2">
            {compareMode && selectedIds.size === 2 && (
              <Button size="sm" onClick={handleCompare}>
                <GitCompareArrows className="h-4 w-4 mr-1.5" />
                {t('compare.compare')}
              </Button>
            )}
            <Button
              variant={compareMode ? 'secondary' : 'ghost'}
              size="sm"
              onClick={handleToggleCompareMode}
            >
              <GitCompareArrows className="h-4 w-4 mr-1.5" />
              {t(compareMode ? 'common.cancel' : 'compare.compare')}
            </Button>
          </div>
        )}
      </div>

      {compareMode && (
        <div className="px-4 py-2 border-b bg-muted/50 text-sm text-muted-foreground">
          {t('compare.selectHint', { count: selectedIds.size })}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {playbookLoading || executionsLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : executions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {t('executions.empty')}
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto">
            {executions.map((exec) => {
              const isSelected = selectedIds.has(exec.id);
              return (
                <button
                  key={exec.id}
                  className={`w-full flex items-center justify-between p-4 border rounded-lg hover:bg-secondary/50 transition-colors text-left ${
                    isSelected ? 'border-primary ring-1 ring-primary/30' : ''
                  }`}
                  onClick={() => {
                    if (compareMode) {
                      handleToggleSelect(exec.id);
                    } else {
                      navigate(`/playbooks/${id}/executions/${exec.id}`);
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    {compareMode && (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggleSelect(exec.id)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={!isSelected && selectedIds.size >= 2}
                        className="shrink-0"
                      />
                    )}
                    <PlaybookStatusBadge status={exec.status} size="md" />
                    <div>
                      <div className="font-medium text-sm">
                        {t('execution.run')} #{exec.executionNumber}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatPlaybookDateTime(exec.createdAt, {
                          timeZone: playbook?.executionSchedule?.timezone,
                        })}{' '}
                        ·{' '}
                        {exec.executionTrigger === 'scheduled'
                          ? t('execution.trigger.scheduled')
                          : t('execution.trigger.manual')}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatDuration(exec.durationMs)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
