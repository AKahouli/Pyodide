import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useModuleTranslation } from '@/modules/localization';
import { useExecutionReport, useGenerateExecutionReport } from '../query/hooks';

interface StreamReportPageProps {
  streamId?: string;
}

/**
 * Final execution report (Part 4 §6). Read-only Markdown + summary
 * + metadata. Auto-generates the report on mount if none exists.
 */
export function StreamReportPage({ streamId: streamIdProp }: StreamReportPageProps) {
  const { t } = useModuleTranslation('worky');
  const params = useParams<{ streamId: string }>();
  const streamId = streamIdProp ?? params.streamId ?? '';
  const { data: report, isLoading } = useExecutionReport(streamId);
  const generate = useGenerateExecutionReport(streamId);

  useEffect(() => {
    if (!isLoading && !report) {
      generate.mutate();
    }
  }, [isLoading, report, generate]);

  if (isLoading) {
    return <div data-testid="report-loading">{t('report.loading')}</div>;
  }
  if (!report) {
    return (
      <div data-testid="report-empty" className="p-4 text-sm text-gray-500">
        {t('report.empty')}
        <button
          type="button"
          data-testid="report-generate"
          onClick={() => generate.mutate()}
          className="ml-2 text-blue-600 hover:underline"
        >
          {t('report.generate')}
        </button>
      </div>
    );
  }

  const meta = report.metadata as {
    taskCount?: number;
    workerCount?: number;
    interactionCount?: number;
    auditCount?: number;
    costEventCount?: number;
    budgetExhausted?: boolean;
  };

  return (
    <div data-testid="report-page" className="space-y-4 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('report.title')}</h2>
        <span
          data-testid="report-type"
          className="rounded bg-gray-100 px-2 py-0.5 text-xs"
        >
          {report.type}
        </span>
      </header>
      <p
        data-testid="report-summary"
        className="rounded bg-gray-50 p-3 text-sm"
      >
        {report.summary}
      </p>
      {meta && (
        <dl
          data-testid="report-metadata"
          className="grid grid-cols-2 gap-2 rounded border border-gray-200 p-3 text-xs"
        >
          <div>
            <dt className="text-gray-500">{t('report.meta.tasks')}</dt>
            <dd>{meta.taskCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('report.meta.workers')}</dt>
            <dd>{meta.workerCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('report.meta.interactions')}</dt>
            <dd>{meta.interactionCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('report.meta.costEvents')}</dt>
            <dd>{meta.costEventCount ?? 0}</dd>
          </div>
          {meta.budgetExhausted && (
            <div className="col-span-2 text-red-700">
              {t('report.meta.budgetExhausted')}
            </div>
          )}
        </dl>
      )}
      <pre
        data-testid="report-markdown"
        className="overflow-x-auto rounded border border-gray-200 bg-white p-3 text-xs"
      >
        {report.markdown}
      </pre>
    </div>
  );
}
