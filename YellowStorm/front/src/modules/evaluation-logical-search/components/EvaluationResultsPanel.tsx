import { Fragment, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { EvaluationNarrativePanel } from './EvaluationNarrativePanel';
import { EvaluationAnswerWithCitations } from './EvaluationAnswerWithCitations';
import type { EvaluationQueryResult, EvaluationResultsResponse } from '../types';

interface Props {
  evaluationId: string;
  status: string;
  evaluationName: string;
  data: EvaluationResultsResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function formatPct(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatNum(value: number | undefined | null, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function formatMs(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-lg border p-3'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='text-lg font-semibold'>{value}</p>
    </div>
  );
}

export function EvaluationResultsPanel({ evaluationId, status, evaluationName, data, loading, error, onClose }: Props): JSX.Element {
  const { t } = useModuleTranslation('evaluation-logical-search');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const summary = data?.summary ?? null;
  const results = useMemo(() => data?.results ?? [], [data]);

  const toggle = (queryId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(queryId)) next.delete(queryId);
      else next.add(queryId);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-3 space-y-0'>
        <CardTitle>{t('results.title', { name: evaluationName })}</CardTitle>
        <Button size='sm' variant='outline' onClick={onClose}>
          {t('results.close')}
        </Button>
      </CardHeader>
      <CardContent className='space-y-4'>
        {loading && <p className='text-sm text-muted-foreground'>{t('results.loading')}</p>}
        {error && <p className='text-sm text-destructive'>{error}</p>}
        {!loading && !error && results.length === 0 && (
          <p className='text-sm text-muted-foreground'>{t('results.empty')}</p>
        )}

        {summary && (
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
            <Kpi label={t('results.kpi.correctness')} value={formatPct(summary.mean_answer_correctness)} />
            <Kpi label={t('results.kpi.semantic')} value={formatPct(summary.mean_semantic_similarity)} />
            <Kpi label={t('results.kpi.factRecall')} value={formatPct(summary.mean_fact_recall)} />
            <Kpi label={t('results.kpi.fileRecall')} value={formatPct(summary.mean_file_recall)} />
            <Kpi label={t('results.kpi.retrievalSuccess')} value={formatPct(summary.retrieval_success_rate)} />
            <Kpi
              label={t('results.kpi.completed')}
              value={`${summary.completed_queries} / ${summary.query_count}${
                summary.failed_queries > 0 ? ` (${summary.failed_queries} ✗)` : ''
              }`}
            />
          </div>
        )}

        {results.length > 0 && (
          <div className='max-h-[60vh] min-h-[200px] overflow-auto rounded-md border'>
            <table className='w-full text-sm'>
              <thead className='sticky top-0 z-10 bg-background'>
                <tr className='border-b text-left text-muted-foreground'>
                  <th className='pb-2 pr-4'>{t('results.table.id')}</th>
                  <th className='pb-2 pr-4'>{t('results.table.question')}</th>
                  <th className='pb-2 pr-4'>{t('results.table.status')}</th>
                  <th className='pb-2 pr-4'>{t('results.table.score')}</th>
                  <th className='pb-2 pr-4'>{t('results.table.fileRecall')}</th>
                  <th className='pb-2 pr-4'>{t('results.table.duration')}</th>
                  <th className='pb-2'>{t('results.table.tokens')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r: EvaluationQueryResult) => {
                  const isOpen = expanded.has(r.query_id);
                  return (
                    <Fragment key={r.query_id}>
                      <tr
                        className='cursor-pointer border-b last:border-0 hover:bg-muted/40'
                        onClick={() => toggle(r.query_id)}
                      >
                        <td className='py-2 pr-4 font-mono text-xs'>{r.query_id}</td>
                        <td className='max-w-xs truncate py-2 pr-4'>{r.query}</td>
                        <td className='py-2 pr-4'>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.status === 'completed'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                          }`}>
                            {t(`status.${r.status === 'completed' ? 'completed' : 'failed'}`)}
                          </span>
                        </td>
                        <td className='py-2 pr-4'>{formatPct(r.judge_score)}</td>
                        <td className='py-2 pr-4'>{formatPct(r.metrics?.retrieval?.file_recall)}</td>
                        <td className='py-2 pr-4'>{formatMs(r.duration_ms)}</td>
                        <td className='py-2'>{r.token_usage?.total_tokens ?? '—'}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${r.query_id}-detail`} className='border-b bg-muted/30'>
                          <td colSpan={7} className='space-y-3 p-4 text-xs'>
                            <div className='grid gap-3 sm:grid-cols-2'>
                              <div>
                                <p className='font-medium text-muted-foreground'>{t('results.detail.expectedAnswer')}</p>
                                <p className='whitespace-pre-wrap'>{r.expected_answer || '—'}</p>
                              </div>
                              <div>
                                <p className='font-medium text-muted-foreground'>{t('results.detail.generatedAnswer')}</p>
                                <EvaluationAnswerWithCitations content={r.generated_answer || '—'} citations={r.citations ?? []} />
                              </div>
                              <div>
                                <p className='font-medium text-muted-foreground'>{t('results.detail.expectedFiles')}</p>
                                <p>{r.required_file?.length ? r.required_file.join(', ') : '—'}</p>
                              </div>
                              <div>
                                <p className='font-medium text-muted-foreground'>{t('results.detail.retrievedFiles')}</p>
                                <p>{r.retrieved_files?.length ? r.retrieved_files.join(', ') : '—'}</p>
                              </div>
                            </div>
                            {r.judge_reasoning && (
                              <div>
                                <p className='font-medium text-muted-foreground'>{t('results.detail.judgeReasoning')}</p>
                                <p className='whitespace-pre-wrap'>{r.judge_reasoning}</p>
                              </div>
                            )}
                            {r.error && (
                              <div>
                                <p className='font-medium text-muted-foreground'>{t('results.detail.error')}</p>
                                <p className='text-destructive'>{r.error}</p>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <EvaluationNarrativePanel evaluationId={evaluationId} status={status} />
      </CardContent>
    </Card>
  );
}
