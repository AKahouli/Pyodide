import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { TaskResult } from '../types';
import { StepComponents } from './StepComponents';

function getStatusTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
    case 'failed':
      return 'bg-destructive/10 text-destructive border-destructive/20';
    case 'running':
      return 'bg-primary/10 text-primary border-primary/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function getStatusLabel(t: unknown, status: string): string {
  const key = `execution.status.${status}`;
  const translated = (t as (key: string) => string)(key);
  return translated === key ? status : translated;
}

interface Props {
  step: TaskResult;
}

export function IteratorResultPanel({ step }: Props) {
  const { t } = useModuleTranslation('playbook');
  const [openIterations, setOpenIterations] = useState<Record<number, boolean>>({ 0: true });
  const iterations = step.iteratorIterations || [];

  if (iterations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
        {t('iterator.results.summary', { count: iterations.length })}
      </div>

      {iterations.map((iteration) => {
        const isOpen = openIterations[iteration.index] ?? false;
        return (
          <Collapsible
            key={`${step.taskId}-iteration-${iteration.index}`}
            open={isOpen}
            onOpenChange={(nextOpen) => setOpenIterations((current) => ({ ...current, [iteration.index]: nextOpen }))}
            className="rounded-lg border bg-background"
          >
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex h-auto w-full items-start justify-between rounded-lg px-4 py-3 text-left">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t('iterator.results.iterationLabel', { index: iteration.index + 1 })}</span>
                    <Badge variant="outline" className={cn('border', getStatusTone(iteration.status))}>
                      {getStatusLabel(t, iteration.status)}
                    </Badge>
                  </div>
                  {iteration.itemPreview && (
                    <p className="break-words text-xs text-muted-foreground">
                      {t('iterator.results.itemPreview')}: {iteration.itemPreview}
                    </p>
                  )}
                </div>
                <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>

            <CollapsibleContent className="space-y-3 border-t px-4 py-3">
              {iteration.error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {iteration.error}
                </div>
              )}

              {iteration.output && (
                <div className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                  {iteration.output}
                </div>
              )}

              <div className="space-y-3">
                {iteration.childResults.map((child) => (
                  <div key={`${iteration.index}-${child.taskId}`} className="rounded-md border bg-muted/10 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-medium">{child.taskTitle || child.taskId}</span>
                      <Badge variant="outline" className={cn('border', getStatusTone(child.status))}>
                        {getStatusLabel(t, child.status)}
                      </Badge>
                    </div>

                    {child.error && (
                      <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                        {child.error}
                      </div>
                    )}

                    {child.components && child.components.length > 0 ? (
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <StepComponents components={child.components} taskId={child.taskId} />
                      </div>
                    ) : child.output ? (
                      <div className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                        {child.output}
                      </div>
                    ) : null}

                    {child.artifacts && child.artifacts.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {child.artifacts.map((artifact, index) => (
                          <span key={`${child.taskId}-artifact-${index}`} className="rounded-full border px-2 py-1">
                            {artifact.filename || artifact.portId}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
