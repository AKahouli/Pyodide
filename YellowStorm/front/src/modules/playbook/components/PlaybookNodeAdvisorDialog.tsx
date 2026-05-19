import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import type { PlaybookNodeAdvisorSuggestion } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface PlaybookNodeAdvisorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  loading: boolean;
  suggestions: PlaybookNodeAdvisorSuggestion[];
  onApply: (suggestion: PlaybookNodeAdvisorSuggestion) => void;
}

function canApplySuggestion(suggestion: PlaybookNodeAdvisorSuggestion): boolean {
  const patch = suggestion.patch;
  return Boolean(patch && (patch.taskTitle || patch.taskDescription || patch.assignedAgentId));
}

export function PlaybookNodeAdvisorDialog({
  open,
  onOpenChange,
  taskTitle,
  loading,
  suggestions,
  onApply,
}: Readonly<PlaybookNodeAdvisorDialogProps>) {
  const { t } = useModuleTranslation('playbook');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('nodeAdvisor.title')}</DialogTitle>
          <DialogDescription>{t('nodeAdvisor.description', { title: taskTitle || t('node.untitled') })}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            <span>{t('nodeAdvisor.loading')}</span>
          </div>
        ) : suggestions.length === 0 ? (
          <div className="py-10 text-sm text-muted-foreground">{t('nodeAdvisor.empty')}</div>
        ) : (
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            {suggestions.map((suggestion) => {
              const applyEnabled = canApplySuggestion(suggestion);
              return (
                <div key={suggestion.id} className="rounded-lg border bg-card p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{suggestion.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{suggestion.summary}</div>
                    </div>
                    <Badge variant="outline">{t(`nodeAdvisor.type.${suggestion.type}`)}</Badge>
                  </div>
                  <div className="mb-2 text-xs text-muted-foreground">{t('nodeAdvisor.confidence', { value: Math.round(suggestion.confidence * 100) })}</div>
                  <div className="text-sm text-foreground">{suggestion.rationale}</div>
                  {suggestion.warnings?.length ? (
                    <div className="mt-3 space-y-1">
                      {suggestion.warnings.map((warning, index) => (
                        <div key={`${suggestion.id}-warning-${index}`} className="text-xs text-amber-700">{warning}</div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-4 flex justify-end">
                    {applyEnabled ? (
                      <Button size="sm" onClick={() => onApply(suggestion)}>{t('nodeAdvisor.apply')}</Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled>{t('nodeAdvisor.reviewOnly')}</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
