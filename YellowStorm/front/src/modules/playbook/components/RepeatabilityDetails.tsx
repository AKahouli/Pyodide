import { Loader2, ChevronDown, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useState, useCallback } from 'react';
import type { Worksheet } from 'exceljs';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { AdvisorResultPanel } from './AdvisorResultPanel';
import type { PlaybookRepeatabilitySummary, RepeatabilityIterationSummary, RepeatabilityTaskExecutionSummary } from '../types';

const PAGE_SIZE = 5;
const EXPORT_PAGE_SIZE = 100;

type ExcelModule = typeof import('exceljs');

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${Math.round(value)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatBoolean(value: boolean | null | undefined, t: (key: string) => string): string {
  if (value === null || value === undefined) return '-';
  return value ? t('detail.boolean.true') : t('detail.boolean.false');
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'playbook';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function joinList(value: string[] | null | undefined): string {
  return Array.isArray(value) && value.length > 0 ? value.join('\n') : '-';
}

function addHeaderRow(worksheet: Pick<Worksheet, 'addRow'>, headers: string[]): void {
  const row = worksheet.addRow(headers);
  row.font = { ...row.font, bold: true };
}

async function writeRepeatabilityWorkbook(
  repeatability: PlaybookRepeatabilitySummary,
  t: (key: string, options?: Record<string, unknown>) => string,
): Promise<void> {
  const excelModule: ExcelModule = await import('exceljs');
  const workbook = new excelModule.Workbook();
  workbook.creator = 'Yellowmind';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet(t('repeatability.export.sheet.summary'));
  summarySheet.columns = [{ width: 34 }, { width: 24 }];
  summarySheet.addRows([
    [t('repeatability.export.field.generatedAt'), formatDate(repeatability.generatedAt)],
    [t('repeatability.overallAverageMatch'), formatPercent(repeatability.overallAverageMatchScore)],
    [t('repeatability.overallAdvisorScore'), formatPercent(repeatability.overallAdvisorScore)],
    [t('repeatability.passedIterations'), `${repeatability.passedIterations} / ${repeatability.evaluatedIterations}`],
    [t('repeatability.totalIterations'), repeatability.totalIterations],
  ]);

  const iterationsSheet = workbook.addWorksheet(t('repeatability.export.sheet.iterations'));
  iterationsSheet.columns = [
    { width: 16 },
    { width: 24 },
    { width: 12 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
  ];
  addHeaderRow(iterationsSheet, [
    t('repeatability.export.column.executionNumber'),
    t('repeatability.export.column.completedAt'),
    t('repeatability.export.column.taskCount'),
    t('repeatability.export.column.evaluatedTasks'),
    t('repeatability.export.column.passedTasks'),
    t('repeatability.export.column.averageMatchScore'),
    t('repeatability.export.column.passed'),
  ]);
  repeatability.iterations.forEach((iteration) => {
    iterationsSheet.addRow([
      iteration.executionNumber,
      formatDate(iteration.completedAt),
      iteration.taskCount,
      iteration.evaluatedTasks,
      iteration.passedTasks,
      formatPercent(iteration.averageMatchScore),
      formatBoolean(iteration.passed, t),
    ]);
  });

  const tasksSheet = workbook.addWorksheet(t('repeatability.export.sheet.tasks'));
  tasksSheet.columns = [
    { width: 16 },
    { width: 28 },
    { width: 24 },
    { width: 18 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 42 },
    { width: 42 },
    { width: 42 },
    { width: 42 },
  ];
  addHeaderRow(tasksSheet, [
    t('repeatability.export.column.executionNumber'),
    t('repeatability.export.column.taskTitle'),
    t('repeatability.export.column.completedAt'),
    t('repeatability.export.column.matchState'),
    t('repeatability.export.column.matchScore'),
    t('repeatability.export.column.advisorOverallScore'),
    t('repeatability.export.column.advisorToolUsageScore'),
    t('repeatability.export.column.advisorConfidence'),
    t('repeatability.export.column.expectedResultSource'),
    t('repeatability.export.column.expectedResultType'),
    t('repeatability.export.column.expectedResultMatched'),
    t('repeatability.export.column.passed'),
    t('repeatability.export.column.expectedResultReason'),
    t('repeatability.export.column.advisorReason'),
    t('repeatability.export.column.rewriteHints'),
    t('repeatability.export.column.output'),
  ]);
  repeatability.iterations.forEach((iteration) => {
    iteration.tasks.forEach((task) => {
      tasksSheet.addRow([
        iteration.executionNumber,
        task.taskTitle || task.taskId,
        formatDate(task.completedAt),
        t(`repeatability.matchState.${task.matchState}`),
        formatPercent(task.matchScore),
        formatPercent(task.judgeResult?.overallScore),
        formatPercent(task.judgeResult?.toolUsageScore),
        formatPercent(task.judgeResult?.confidence),
        t(`repeatability.source.${task.expectedResultSource}`),
        task.expectedResultType ? t(`repeatability.expectedResultType.${task.expectedResultType}`) : '-',
        formatBoolean(task.expectedResultMatched, t),
        formatBoolean(task.passed, t),
        task.expectedResultReason || '-',
        task.judgeResult?.reason || '-',
        joinList(task.judgeResult?.rewriteHints),
        task.output || '-',
      ]);
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, `playbook-repeatability-${sanitizeFilenamePart(repeatability.playbookId)}.xlsx`);
}

function getScoreTone(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'border-border/60 bg-muted/20';
  if (value >= 80) return 'border-emerald-500/30 bg-emerald-500/10';
  if (value >= 60) return 'border-amber-500/30 bg-amber-500/10';
  return 'border-rose-500/30 bg-rose-500/10';
}

function getMatchStateBadge(state: RepeatabilityTaskExecutionSummary['matchState']) {
  if (state === 'matched') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
  if (state === 'not_matched') return 'border-rose-500/30 bg-rose-500/10 text-rose-700';
  return 'border-slate-400/40 bg-slate-500/10 text-slate-600';
}

function getPassedBadge(passed: boolean) {
  if (passed) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
  return 'border-rose-500/30 bg-rose-500/10 text-rose-700';
}

function MetricCard({
  label,
  value,
  className,
}: Readonly<{
  label: string;
  value: string;
  className?: string;
}>) {
  return (
    <div className={cn('rounded border p-3', className)}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function TaskExecutionPane({ task }: Readonly<{ task: RepeatabilityTaskExecutionSummary }>) {
  const { t } = useModuleTranslation('playbook');
  const headerMatchState = task.advisorEvaluated ? task.matchState : 'not_evaluated';

  return (
    <Collapsible defaultOpen={false} className="rounded-md border bg-background/60 px-3 py-2">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
          <span className="truncate text-xs font-medium">{task.taskTitle || task.taskId}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', getMatchStateBadge(headerMatchState))}>
            {t(`repeatability.matchState.${headerMatchState}`)}
          </Badge>
          <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', getScoreTone(task.matchScore))}>
            {formatPercent(task.matchScore)}
          </Badge>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        {task.judgeResult ? (
          <AdvisorResultPanel judgeResult={task.judgeResult} />
        ) : (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t('repeatability.expectedResult')}</div>
            <div className="max-h-32 overflow-auto rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap break-words">
              {task.expectedResult || t('repeatability.expectedResultMissing')}
            </div>
          </div>
        )}

        {task.output && !task.judgeResult && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t('repeatability.output')}</div>
            <pre className="max-h-40 overflow-auto rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap break-words">
              {task.output}
            </pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function IterationPane({ iteration }: Readonly<{ iteration: RepeatabilityIterationSummary }>) {
  const { t } = useModuleTranslation('playbook');

  return (
    <Collapsible defaultOpen={false} className="rounded-md border bg-background p-4">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
          <span className="text-sm font-medium">
            {t('repeatability.iterationNumber', { number: iteration.executionNumber })}
          </span>
          {iteration.completedAt && (
            <span className="text-xs text-muted-foreground">{formatDate(iteration.completedAt)}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', getPassedBadge(iteration.passed))}>
            {t('repeatability.passedTasks', { passed: iteration.passedTasks, total: iteration.evaluatedTasks })}
          </Badge>
          <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', getScoreTone(iteration.averageMatchScore))}>
            {formatPercent(iteration.averageMatchScore)}
          </Badge>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-2 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        {iteration.tasks.length === 0 ? (
          <div className="rounded border bg-muted/20 p-3 text-xs text-muted-foreground">{t('repeatability.noTasks')}</div>
        ) : (
          iteration.tasks.map((task) => (
            <TaskExecutionPane key={task.taskId} task={task} />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RepeatabilityDetails({
  repeatability,
  loading = false,
  className,
  onPageFetch,
  onExportFetch,
}: Readonly<{
  repeatability: PlaybookRepeatabilitySummary | null;
  loading?: boolean;
  className?: string;
  onPageFetch?: (limit: number, offset: number) => Promise<PlaybookRepeatabilitySummary>;
  onExportFetch?: (limit: number, offset: number) => Promise<PlaybookRepeatabilitySummary>;
}>) {
  const { t } = useModuleTranslation('playbook');
  const [page, setPage] = useState(0);
  const [exportLoading, setExportLoading] = useState(false);

  const totalPages = repeatability ? Math.max(1, Math.ceil(repeatability.totalIterations / PAGE_SIZE)) : 1;

  const handlePageChange = useCallback(async (newPage: number) => {
    if (!onPageFetch) return;
    const offset = newPage * PAGE_SIZE;
    await onPageFetch(PAGE_SIZE, offset);
    setPage(newPage);
  }, [onPageFetch]);

  const handleExport = useCallback(async () => {
    if (!repeatability || exportLoading) return;

    setExportLoading(true);
    try {
      let exportData = repeatability;
      if (onExportFetch) {
        const firstPage = await onExportFetch(EXPORT_PAGE_SIZE, 0);
        const allIterations = [...firstPage.iterations];
        for (let offset = EXPORT_PAGE_SIZE; offset < firstPage.totalIterations; offset += EXPORT_PAGE_SIZE) {
          const nextPage = await onExportFetch(EXPORT_PAGE_SIZE, offset);
          allIterations.push(...nextPage.iterations);
        }
        exportData = { ...firstPage, iterations: allIterations };
      }

      const exportT = (key: string, options?: Record<string, unknown>) =>
        t(key as Parameters<typeof t>[0], options as Parameters<typeof t>[1]);
      await writeRepeatabilityWorkbook(exportData, exportT);
      showSuccess(t('repeatability.export.success'));
    } catch {
      showError(t('repeatability.export.failed'));
    } finally {
      setExportLoading(false);
    }
  }, [exportLoading, onExportFetch, repeatability, t]);

  if (loading) {
    return (
      <div className={cn('flex min-h-40 items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground', className)}>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('repeatability.loading')}
      </div>
    );
  }

  if (!repeatability) {
    return (
      <div className={cn('rounded-lg border bg-muted/20 p-6 text-sm text-muted-foreground', className)}>
        {t('repeatability.noData')}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4 rounded-lg border bg-muted/20 p-4 text-sm', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('repeatability.title')}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t('repeatability.generatedAt', { date: formatDate(repeatability.generatedAt) })}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleExport()}
          disabled={exportLoading}
          aria-label={t('repeatability.export.button')}
        >
          {exportLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          {t('repeatability.export.button')}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard
          label={t('repeatability.overallAverageMatch')}
          value={formatPercent(repeatability.overallAverageMatchScore)}
          className={getScoreTone(repeatability.overallAverageMatchScore)}
        />
        <MetricCard
          label={t('repeatability.overallAdvisorScore')}
          value={formatPercent(repeatability.overallAdvisorScore)}
          className={getScoreTone(repeatability.overallAdvisorScore)}
        />
        <MetricCard
          label={t('repeatability.passedIterations')}
          value={`${repeatability.passedIterations} / ${repeatability.evaluatedIterations}`}
        />
        <MetricCard
          label={t('repeatability.totalIterations')}
          value={String(repeatability.totalIterations)}
        />
      </div>

      {repeatability.iterations.length === 0 ? (
        <div className="rounded-md border bg-background p-4 text-sm text-muted-foreground">
          {t('repeatability.noIterations')}
        </div>
      ) : (
        <div className="space-y-2">
          {repeatability.iterations.map((iteration) => (
            <IterationPane key={iteration.executionId} iteration={iteration} />
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                {t('repeatability.pagination', { page: page + 1, total: totalPages })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page === 0 || loading}
                  onClick={() => void handlePageChange(page - 1)}
                  aria-label={t('repeatability.prevPage')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page >= totalPages - 1 || loading}
                  onClick={() => void handlePageChange(page + 1)}
                  aria-label={t('repeatability.nextPage')}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
