import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SearchSelect } from '@/components/ui/search-select';
import { useModuleTranslation } from '@/modules/localization';
import { apiClient } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import { evaluationLogicalSearchApi } from '../api';
import type { LogicalSearchEvaluation, UploadResult, BenchmarkQuery } from '../types';

interface PlaybookSummary {
  id: string;
  name: string;
}
interface ExecutionSummary {
  _id: string;
  status: string;
  flowId: string;
  createdAt: string;
}

export function LogicalSearchEvaluationPage(): JSX.Element {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('evaluation-logical-search');

  // ── Selection state ─────────────────────────────────────────
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string>('');
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string>('');

  // ── Upload state ────────────────────────────────────────────
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [runningEvalId, setRunningEvalId] = useState<string | null>(null);
  const [stoppingEvalId, setStoppingEvalId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [evalProgress, setEvalProgress] = useState<Record<string, { done: number; total: number; currentQuery: string }>>({});

  // ── History ─────────────────────────────────────────────────
  const [evaluations, setEvaluations] = useState<LogicalSearchEvaluation[]>([]);
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null);

  // ── Load playbooks ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ data: { items: PlaybookSummary[] } }>(API_ENDPOINTS.playbooks.list)
      .then((res) => { if (!cancelled) setPlaybooks(res.data.data.items ?? []); })
      .catch(() => { if (!cancelled) setPlaybooks([]); });
    return () => { cancelled = true; };
  }, []);

  // ── Load executions when playbook changes ────────────────────
  useEffect(() => {
    if (!selectedPlaybookId) { setExecutions([]); setSelectedExecutionId(''); return; }
    let cancelled = false;
    apiClient.get<{ data: { items?: ExecutionSummary[]; executions?: ExecutionSummary[] } }>(API_ENDPOINTS.playbookFlows.executions(selectedPlaybookId))
      .then((res) => {
        if (cancelled) return;
        const { items, executions } = res.data.data ?? {};
        setExecutions(items ?? executions ?? []);
      })
      .catch(() => { if (!cancelled) setExecutions([]); });
    return () => { cancelled = true; };
  }, [selectedPlaybookId]);

  // ── Load previous evaluations ────────────────────────────────
  const refreshEvaluations = useCallback(() => {
    evaluationLogicalSearchApi.list().then(setEvaluations).catch(() => setEvaluations([]));
  }, []);
  useEffect(() => { refreshEvaluations(); }, [refreshEvaluations]);

  // ── Handlers ────────────────────────────────────────────────
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await evaluationLogicalSearchApi.upload(file);
      setUploadResult(result);
      setSelectedEvalId(result.evaluationId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }, []);

  const handlePrepare = useCallback(async () => {
    const targetId = selectedEvalId ?? evaluations[0]?.id;
    if (!targetId || !selectedExecutionId) return;
    setPreparing(true);
    setPrepareError(null);
    try {
      await evaluationLogicalSearchApi.prepare(targetId, {
        executionId: selectedExecutionId,
      });
      refreshEvaluations();
    } catch (err) {
      setPrepareError(err instanceof Error ? err.message : 'Prepare failed');
    } finally {
      setPreparing(false);
    }
  }, [selectedEvalId, selectedExecutionId, evaluations, refreshEvaluations]);

  const handleRun = useCallback(async (id: string) => {
    setRunningEvalId(id);
    setRunError(null);
    try {
      await evaluationLogicalSearchApi.run(id);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunningEvalId(null);
      refreshEvaluations();
    }
  }, [refreshEvaluations]);

  const handleStop = useCallback(async (id: string) => {
    setStoppingEvalId(id);
    setRunError(null);
    try {
      await evaluationLogicalSearchApi.stop(id);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Stop failed');
    } finally {
      setStoppingEvalId(null);
      refreshEvaluations();
    }
  }, [refreshEvaluations]);

  const handleExport = useCallback(async (id: string) => {
    setExportError(null);
    try {
      const { blob, filename } = await evaluationLogicalSearchApi.exportResults(id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    }
  }, []);

  const refreshProgress = useCallback(() => {
    let cancelled = false;
    Promise.all(
      evaluations
        .filter((e) => e.status === 'running')
        .map((e) => evaluationLogicalSearchApi.progress(e.id)),
    )
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, { done: number; total: number; currentQuery: string }> = {};
        for (const r of results) {
          if (r.progress) {
            next[r.evaluationId] = { done: r.progress.done, total: r.progress.total, currentQuery: r.progress.currentQuery };
          }
        }
        setEvalProgress(next);
      })
      .catch(() => { if (!cancelled) setEvalProgress({}); });
    return () => { cancelled = true; };
  }, [evaluations]);

  // Poll while a run request is in flight or any evaluation is still running.
  useEffect(() => {
    const running = runningEvalId !== null || evaluations.some((e) => e.status === 'running');
    if (!running) return;
    const interval = window.setInterval(() => {
      void refreshEvaluations();
      void refreshProgress();
    }, 2500);
    return () => window.clearInterval(interval);
  }, [runningEvalId, evaluations, refreshEvaluations, refreshProgress]);

  // ── Derived ─────────────────────────────────────────────────
  const latestExecution = useMemo(() => executions.find((e) => e.status === 'completed'), [executions]);
  const previewRows: BenchmarkQuery[] = useMemo(() => uploadResult?.preview ?? [], [uploadResult]);
  const prepareEvalName = useMemo(
    () => evaluations.find((e) => e.id === (selectedEvalId ?? evaluations[0]?.id))?.name ?? '',
    [evaluations, selectedEvalId],
  );

  return (
    <div className='h-full w-full overflow-auto'>
      <div className='mx-auto max-w-4xl space-y-6 p-6'>
      <h1 className='text-2xl font-bold'>{t('upload.title')}</h1>

      {/* ── Upload ─────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>{t('upload.title')}</CardTitle></CardHeader>
        <CardContent>
          <label className='flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer hover:border-primary/50 transition-colors'>
            <span className='text-sm text-muted-foreground'>{t('upload.dropzone')}</span>
            <span className='text-xs text-muted-foreground'>{t('upload.accept')}</span>
            <input type='file' accept='.xlsx,.csv' className='hidden' onChange={handleFileChange} />
            {uploading && <Progress value={50} className='w-full' />}
          </label>
          {uploadError && <p className='mt-2 text-sm text-destructive'>{uploadError}</p>}
          {uploadResult && (
            <div className='mt-4 rounded-lg bg-muted/50 p-4 text-sm'>
              <p className='font-medium'>{t('upload.success')}</p>
              <p>{t('preview.sheet', { name: uploadResult.sheetName })}</p>
              <p>{t('preview.questions', { count: uploadResult.queryCount })}</p>
              {uploadResult.skippedRows > 0 && (
                <p className='text-muted-foreground'>{t('preview.skipped', { count: uploadResult.skippedRows })}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Preview ─────────────────────────────────────────── */}
      {previewRows.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('preview.title')}</CardTitle></CardHeader>
          <CardContent>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='border-b text-left text-muted-foreground'>
                    <th className='pb-2 pr-4'>{t('preview.queryId')}</th>
                    <th className='pb-2 pr-4'>{t('preview.question')}</th>
                    <th className='pb-2 pr-4'>{t('preview.answer')}</th>
                    <th className='pb-2'>{t('preview.files')}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((q) => (
                    <tr key={q.query_id} className='border-b last:border-0'>
                      <td className='py-2 pr-4 font-mono text-xs'>{q.query_id}</td>
                      <td className='py-2 pr-4 max-w-xs truncate'>{q.query}</td>
                      <td className='py-2 pr-4 max-w-xs truncate text-muted-foreground'>{q.answer || '—'}</td>
                      <td className='py-2 text-xs text-muted-foreground'>{q.required_file.length} files, {q.page.length} pages</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Selection: Agent → Playbook → Workspace ─────────── */}
      <Card>
        <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
        <CardContent className='space-y-4'>
          {/* Playbook */}
          <div className='space-y-1'>
            <label className='text-sm font-medium'>{t('select.playbook')}</label>
            <SearchSelect
              options={playbooks.map((p) => ({ value: p.id, label: p.name }))}
              value={selectedPlaybookId}
              onValueChange={(v) => { setSelectedPlaybookId(v); setSelectedExecutionId(''); }}
              placeholder={t('select.playbookPlaceholder')}
              searchPlaceholder={t('select.search')}
              emptyText={t('select.noResults')}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Execution selection + prepare ────────────────────── */}
      {selectedPlaybookId && executions.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('select.execution')}</CardTitle></CardHeader>
          <CardContent className='space-y-4'>
            <select
              className='w-full rounded-md border bg-background px-3 py-2 text-sm'
              value={selectedExecutionId}
              onChange={(e) => setSelectedExecutionId(e.target.value)}
            >
              <option value=''>{t('select.executionPlaceholder')}</option>
              {latestExecution && (
                <option value={latestExecution._id}>
                  {latestExecution._id.slice(-8)} — {t('status.completed')} ({new Date(latestExecution.createdAt).toLocaleDateString()})
                </option>
              )}
              {executions.filter((e) => e !== latestExecution).map((ex) => (
                <option key={ex._id} value={ex._id}>
                  {ex._id.slice(-8)} — {t(`status.${ex.status}` as any) ?? ex.status} ({new Date(ex.createdAt).toLocaleDateString()})
                </option>
              ))}
            </select>

            {evaluations.length > 0 && (
              <>
                <Button
                  onClick={handlePrepare}
                  disabled={!selectedExecutionId || preparing}
                  className='w-full'
                >
                  {preparing ? t('actions.preparing') : t('actions.prepare')}
                </Button>
                <p className='text-xs text-muted-foreground'>
                  {t('actions.prepareTarget', { name: prepareEvalName })}
                </p>
              </>
            )}
            {prepareError && <p className='text-sm text-destructive'>{prepareError}</p>}
          </CardContent>
        </Card>
      )}

      {/* ── History ──────────────────────────────────────────── */}
      {evaluations.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('history.title')}</CardTitle></CardHeader>
          <CardContent>
            {runError && <p className='mb-2 text-sm text-destructive'>{runError}</p>}
            {exportError && <p className='mb-2 text-sm text-destructive'>{exportError}</p>}
            <div className='space-y-2'>
              {evaluations.map((ev) => (
                <div
                  key={ev.id}
                  className={`flex items-center justify-between rounded-lg border p-3 text-sm cursor-pointer transition-colors ${
                    selectedEvalId === ev.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedEvalId(ev.id)}
                >
                  <div className='min-w-0'>
                    <p className='truncate font-medium'>{ev.name}</p>
                    <p className='text-xs text-muted-foreground'>
                      {t('history.createdAt')}: {new Date(ev.createdAt).toLocaleDateString()} · {t('history.queries', { count: ev.queryCount })}
                    </p>
                    {ev.status === 'running' && evalProgress[ev.id] && (
                      <p className='mt-1 truncate text-xs text-primary'>
                        {evalProgress[ev.id].done}/{evalProgress[ev.id].total} · {evalProgress[ev.id].currentQuery}
                      </p>
                    )}
                  </div>
                  <div className='flex shrink-0 items-center gap-2'>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      ev.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                      : ev.status === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                      : 'bg-muted text-muted-foreground'
                    }`}>
                      {t(`status.${ev.status}` as any) ?? ev.status}
                    </span>
                    {(ev.status === 'prepared' || ev.status === 'running' || ev.status === 'failed') && (
                      <Button
                        size='sm'
                        onClick={(e) => { e.stopPropagation(); void handleRun(ev.id); }}
                        disabled={runningEvalId !== null}
                      >
                        {runningEvalId === ev.id ? t('actions.running') : t('actions.run')}
                      </Button>
                    )}
                    {ev.status === 'running' && (
                      <Button
                        size='sm'
                        variant='destructive'
                        onClick={(e) => { e.stopPropagation(); void handleStop(ev.id); }}
                        disabled={stoppingEvalId !== null}
                      >
                        {stoppingEvalId === ev.id ? t('actions.stopping') : t('actions.stop')}
                      </Button>
                    )}
                    {(ev.status === 'completed' || ev.status === 'failed' || ev.status === 'running') && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={(e) => { e.stopPropagation(); void handleExport(ev.id); }}
                      >
                        {t('actions.export')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
