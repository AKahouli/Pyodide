import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SearchSelect } from '@/components/ui/search-select';
import { MultiSelect } from '@/components/ui/multi-select';
import { useModuleTranslation } from '@/modules/localization';
import { parseApiError } from '@/lib/api-error';
import { apiClient } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import { useAgents, useAgentsLoading, useAgentStore } from '@/modules/agent';
import { evaluationLogicalSearchApi } from '../api';
import { EvaluationResultsPanel } from '../components/EvaluationResultsPanel';
import { buildPageWindow } from '../pagination';
import type { LogicalSearchEvaluation, UploadResult, BenchmarkQuery, EvaluationResultsResponse } from '../types';

const HISTORY_PAGE_SIZE = 3;

interface WorkspaceSummary {
  id: string;
  name: string;
}

export function LogicalSearchEvaluationPage(): JSX.Element {
  const { t } = useModuleTranslation('evaluation-logical-search');

  // ── Ad-hoc config state ─────────────────────────────────────
  const agents = useAgents();
  const agentsLoading = useAgentsLoading();
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [selectedEvaluatorAgentId, setSelectedEvaluatorAgentId] = useState<string>('');
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');

  // ── Upload state ────────────────────────────────────────────
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [launching, setLaunching] = useState(false);
  const [launchStage, setLaunchStage] = useState<'preparing' | 'running' | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [runningEvalId, setRunningEvalId] = useState<string | null>(null);
  const [stoppingEvalId, setStoppingEvalId] = useState<string | null>(null);
  const [deletingEvalId, setDeletingEvalId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [evalProgress, setEvalProgress] = useState<Record<string, { done: number; total: number; currentQuery: string }>>({});

  // ── History ─────────────────────────────────────────────────
  const [benchmarks, setBenchmarks] = useState<LogicalSearchEvaluation[]>([]);
  const [runs, setRuns] = useState<LogicalSearchEvaluation[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null);
  const [selectedQueryIds, setSelectedQueryIds] = useState<string[]>([]);
  const [historyPage, setHistoryPage] = useState(1);

  // ── Results viewer ──────────────────────────────────────────
  const [openResultsId, setOpenResultsId] = useState<string | null>(null);
  const [resultsData, setResultsData] = useState<EvaluationResultsResponse | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  // ── Load agents ─────────────────────────────────────────────
  useEffect(() => { void useAgentStore.getState().fetchAgents(); }, []);

  // ── Load workspaces (personal + shared) ─────────────────────
  useEffect(() => {
    let cancelled = false;
    setWorkspacesLoading(true);
    Promise.allSettled([
      apiClient.get<{ data: { workspaces: WorkspaceSummary[] } }>(API_ENDPOINTS.workspaces.list),
      apiClient.get<{ data: { workspaces: WorkspaceSummary[] } }>(API_ENDPOINTS.workspaces.sharedWithMe),
    ]).then(([ownRes, sharedRes]) => {
      if (cancelled) return;
      const own = ownRes.status === 'fulfilled' ? ownRes.value.data.data?.workspaces ?? [] : [];
      const shared = sharedRes.status === 'fulfilled' ? sharedRes.value.data.data?.workspaces ?? [] : [];
      const seen = new Set<string>();
      const merged: WorkspaceSummary[] = [];
      for (const w of [...own, ...shared]) {
        if (seen.has(w.id)) continue;
        seen.add(w.id);
        merged.push(w);
      }
      setWorkspaces(merged);
      setWorkspacesLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Load benchmarks and the current page of runs ─────────────
  const refreshLists = useCallback(() => {
    const offset = (historyPage - 1) * HISTORY_PAGE_SIZE;
    Promise.all([
      evaluationLogicalSearchApi.list({ scope: 'benchmarks', limit: 100 }),
      evaluationLogicalSearchApi.list({ scope: 'runs', limit: HISTORY_PAGE_SIZE, offset }),
    ])
      .then(([benchmarkRes, runRes]) => {
        setBenchmarks(benchmarkRes.items);
        setRuns(runRes.items);
        setRunsTotal(runRes.total);
      })
      .catch(() => { setBenchmarks([]); setRuns([]); setRunsTotal(0); });
  }, [historyPage]);
  useEffect(() => { refreshLists(); }, [refreshLists]);

  const submitFile = useCallback(async (file: File) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    try {
      const result = await evaluationLogicalSearchApi.upload(file, setUploadProgress);
      setUploadResult(result);
      setSelectedEvalId(result.evaluationId);
      refreshLists();
    } catch (err) {
      setUploadError(parseApiError(err).message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [refreshLists]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void submitFile(file);
  }, [submitFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void submitFile(file);
  }, [submitFile]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      dragCounter.current += 1;
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleLaunch = useCallback(async () => {
    const source = benchmarks.find((e) => e.id === selectedEvalId) ?? runs.find((e) => e.id === selectedEvalId);
    if (!source || !selectedAgentId || !selectedEvaluatorAgentId || !selectedWorkspaceId) return;
    const queryIds = selectedQueryIds.length > 0 ? selectedQueryIds : undefined;
    setLaunching(true);
    setLaunchStage('preparing');
    setLaunchError(null);
    try {
      // Launching always creates a new evaluation seeded from the selected
      // benchmark, so previous results are never overwritten.
      const { evaluationId } = await evaluationLogicalSearchApi.duplicate(source.id);
      setRunningEvalId(evaluationId);
      await evaluationLogicalSearchApi.prepareAdhoc(evaluationId, {
        agentId: selectedAgentId,
        workspaceId: selectedWorkspaceId || undefined,
        evaluatorAgentId: selectedEvaluatorAgentId,
      });
      setLaunchStage('running');
      await evaluationLogicalSearchApi.run(evaluationId, queryIds);
      refreshLists();
    } catch (err) {
      setRunError(parseApiError(err).message);
    } finally {
      setLaunching(false);
      setLaunchStage(null);
      setRunningEvalId(null);
      refreshLists();
    }
  }, [selectedEvalId, selectedAgentId, selectedEvaluatorAgentId, selectedWorkspaceId, benchmarks, runs, refreshLists, selectedQueryIds]);

  // Resume a failed evaluation in place: re-runs only the queries that did not
  // complete, keeping the attributes stored at prepare time (agent/workspace/judge).
  const handleResume = useCallback(async (id: string) => {
    setRunningEvalId(id);
    setRunError(null);
    try {
      await evaluationLogicalSearchApi.run(id);
    } catch (err) {
      setRunError(parseApiError(err).message);
    } finally {
      setRunningEvalId(null);
      refreshLists();
    }
  }, [refreshLists]);

  const handleStop = useCallback(async (id: string) => {
    setStoppingEvalId(id);
    setRunError(null);
    try {
      await evaluationLogicalSearchApi.stop(id);
    } catch (err) {
      setRunError(parseApiError(err).message);
    } finally {
      setStoppingEvalId(null);
      refreshLists();
    }
  }, [refreshLists]);

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
      setExportError(parseApiError(err).message);
    }
  }, []);

  const loadResults = useCallback(async (id: string) => {
    setResultsLoading(true);
    setResultsError(null);
    try {
      setResultsData(await evaluationLogicalSearchApi.results(id));
    } catch (err) {
      setResultsError(parseApiError(err).message);
    } finally {
      setResultsLoading(false);
    }
  }, [t]);

  const openResults = useCallback((id: string) => {
    setOpenResultsId(id);
    void loadResults(id);
  }, [loadResults]);

  const closeResults = useCallback(() => {
    setOpenResultsId(null);
    setResultsData(null);
    setResultsError(null);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const target = runs.find((e) => e.id === id) ?? benchmarks.find((e) => e.id === id);
    if (!window.confirm(t('history.confirmDelete', { name: target?.name ?? '' }))) return;
    setDeletingEvalId(id);
    setRunError(null);
    try {
      await evaluationLogicalSearchApi.remove(id);
      if (openResultsId === id) closeResults();
      if (selectedEvalId === id) setSelectedEvalId(null);
      setHistoryPage(1);
      refreshLists();
    } catch (err) {
      setRunError(parseApiError(err).message);
    } finally {
      setDeletingEvalId(null);
    }
  }, [runs, benchmarks, t, openResultsId, closeResults, selectedEvalId, refreshLists]);

  const refreshProgress = useCallback(() => {
    let cancelled = false;
    Promise.all(
      runs
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
  }, [runs]);

  // Poll while a run request is in flight or any evaluation is still running.
  useEffect(() => {
    const running = runningEvalId !== null || runs.some((e) => e.status === 'running');
    if (!running) return;
    const interval = window.setInterval(() => {
      void refreshLists();
      void refreshProgress();
      if (openResultsId) void loadResults(openResultsId);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [runningEvalId, runs, refreshLists, refreshProgress, openResultsId, loadResults]);

  // ── Derived ─────────────────────────────────────────────────
  const previewRows: BenchmarkQuery[] = useMemo(() => uploadResult?.preview ?? [], [uploadResult]);
  const activeEvaluation = useMemo(
    () => benchmarks.find((e) => e.id === selectedEvalId) ?? runs.find((e) => e.id === selectedEvalId) ?? null,
    [benchmarks, runs, selectedEvalId],
  );
  const queryOptions = useMemo(() => activeEvaluation?.queries?.queries ?? [], [activeEvaluation]);
  const launchEvalName = useMemo(() => activeEvaluation?.name ?? '', [activeEvaluation]);
  // Benchmarks are the never-run (dataset_ready) datasets; one entry per file.
  const benchmarkOptions = useMemo(() => {
    const byKey = new Map<string, LogicalSearchEvaluation>();
    for (const e of benchmarks) {
      const key = e.sourceFileName || e.name;
      if (!byKey.has(key)) byKey.set(key, e);
    }
    return [...byKey.values()].map((e) => ({ value: e.id, label: `${e.name} · ${e.queryCount}` }));
  }, [benchmarks]);

  // History is server-paginated: `runs` already holds the current page.
  const historyPageCount = Math.max(1, Math.ceil(runsTotal / HISTORY_PAGE_SIZE));
  const activeHistoryPage = Math.min(historyPage, historyPageCount);
  const visibleEvaluations = runs;

  const openResultsEval = useMemo(
    () => (openResultsId ? [...benchmarks, ...runs].find((e) => e.id === openResultsId) ?? null : null),
    [benchmarks, runs, openResultsId],
  );

  useEffect(() => { setSelectedQueryIds([]); }, [selectedEvalId]);

  return (
    <div className='h-full w-full overflow-auto'>
      <div className='mx-auto max-w-4xl space-y-6 p-6'>
      <h1 className='text-2xl font-bold'>{t('page.title')}</h1>
      <p className='text-sm text-muted-foreground'>{t('page.subtitle')}</p>

      {/* ── Upload ─────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>{t('upload.title')}</CardTitle></CardHeader>
        <CardContent>
          <label
            onDrop={handleDrop}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer hover:border-primary/50 transition-colors ${
              isDragOver ? 'border-primary bg-primary/5' : ''
            }`}
          >
            <span className='text-sm text-muted-foreground'>{t('upload.dropzone')}</span>
            <span className='text-xs text-muted-foreground'>{t('upload.accept')}</span>
            <input ref={fileInputRef} type='file' accept='.xlsx,.csv' className='hidden' onChange={handleFileChange} />
            {uploading && (
              <>
                <Progress value={uploadProgress ?? 0} className='w-full' />
                <span className='text-xs text-muted-foreground'>{t('upload.uploading')} {uploadProgress ?? 0}%</span>
              </>
            )}
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

      {/* ── Ad-hoc Configuration ─────────────────────────────── */}
      {benchmarks.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('adhoc.title')}</CardTitle></CardHeader>
          <CardContent className='space-y-4'>

            {/* Benchmark (existing dataset to reuse) */}
            <div className='space-y-1'>
              <label className='text-sm font-medium'>{t('adhoc.benchmark')}</label>
              <SearchSelect
                options={benchmarkOptions}
                value={selectedEvalId ?? ''}
                onValueChange={setSelectedEvalId}
                placeholder={t('adhoc.benchmarkPlaceholder')}
                searchPlaceholder={t('select.search')}
                emptyText={t('select.noResults')}
              />
              <p className='text-xs text-muted-foreground'>{t('adhoc.benchmarkHelp')}</p>
            </div>

            {/* Agent (required) */}
            <div className='space-y-1'>
              <label className='text-sm font-medium'>
                {t('adhoc.agent')} <span className='text-destructive'>*</span>
              </label>
              <SearchSelect
                options={agents.map((a) => ({ value: a.id, label: a.name }))}
                value={selectedAgentId}
                onValueChange={setSelectedAgentId}
                placeholder={agentsLoading ? t('common.loading') : t('adhoc.agentPlaceholder')}
                searchPlaceholder={t('select.search')}
                emptyText={t('select.noResults')}
              />
            </div>

            {/* Workspace (required) */}
            <div className='space-y-1'>
              <label className='text-sm font-medium'>
                {t('adhoc.workspace')} <span className='text-destructive'>*</span>
              </label>
              <SearchSelect
                options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
                value={selectedWorkspaceId}
                onValueChange={setSelectedWorkspaceId}
                placeholder={workspacesLoading ? t('common.loading') : t('adhoc.workspacePlaceholder')}
                searchPlaceholder={t('select.search')}
                emptyText={t('select.noResults')}
              />
            </div>

            {/* Evaluator Agent (required) - LLM Judge */}
            <div className='space-y-1'>
              <label className='text-sm font-medium'>
                {t('adhoc.evaluatorAgent')} <span className='text-destructive'>*</span>
              </label>
              <SearchSelect
                options={agents.map((a) => ({ value: a.id, label: a.name }))}
                value={selectedEvaluatorAgentId}
                onValueChange={setSelectedEvaluatorAgentId}
                placeholder={agentsLoading ? t('common.loading') : t('adhoc.evaluatorAgentPlaceholder')}
                searchPlaceholder={t('select.search')}
                emptyText={t('select.noResults')}
              />
            </div>

            {/* Target questions (optional) */}
            <div className='space-y-1'>
              <label className='text-sm font-medium'>{t('targeted.title')}</label>
              <MultiSelect
                options={queryOptions.map((q) => ({ value: q.query_id, label: `${q.query_id} — ${q.query.slice(0, 60)}` }))}
                value={selectedQueryIds}
                onValueChange={setSelectedQueryIds}
                placeholder={t('targeted.all')}
                searchPlaceholder={t('select.search')}
                emptyText={t('select.noResults')}
              />
              <p className='text-xs text-muted-foreground'>{t('targeted.help')}</p>
            </div>

            {launchError && <p className='text-sm text-destructive'>{launchError}</p>}
            <Button
              onClick={handleLaunch}
              disabled={!selectedEvalId || !selectedAgentId || !selectedEvaluatorAgentId || !selectedWorkspaceId || launching}
              className='w-full'
            >
              {launching ? t('adhoc.launching') : t('adhoc.launch')}
            </Button>
            {launching && launchStage && (
              <p className='text-xs text-primary'>{t(`adhoc.stage.${launchStage}`)}</p>
            )}
            <p className='text-xs text-muted-foreground'>
              {t('adhoc.target', { name: launchEvalName })}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── History ──────────────────────────────────────────── */}
      {runsTotal > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('history.title')}</CardTitle></CardHeader>
          <CardContent>
            {runError && <p className='mb-2 text-sm text-destructive'>{runError}</p>}
            {exportError && <p className='mb-2 text-sm text-destructive'>{exportError}</p>}
            {runs.length === 0 && (
              <p className='text-sm text-muted-foreground'>{t('history.empty')}</p>
            )}
            <div className='space-y-2'>
              {visibleEvaluations.map((ev) => (
                <div
                  key={ev.id}
                  className='flex items-center justify-between rounded-lg border p-3 text-sm'
                >
                  <div className='min-w-0'>
                    <p className='truncate font-medium'>{ev.name}</p>
                    <p className='text-xs text-muted-foreground'>
                      {t('history.createdAt')}: {new Date(ev.createdAt).toLocaleString()} · {t('history.queries', { count: ev.queryCount })}
                    </p>
                    {ev.status === 'running' && evalProgress[ev.id] && (
                      <>
                        <Progress
                          className='mt-1 h-1.5 max-w-xs'
                          value={Math.round((evalProgress[ev.id].done / Math.max(1, evalProgress[ev.id].total)) * 100)}
                        />
                        <p className='mt-1 truncate text-xs text-primary'>
                          {evalProgress[ev.id].done}/{evalProgress[ev.id].total} · {evalProgress[ev.id].currentQuery}
                        </p>
                      </>
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
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={(e) => { e.stopPropagation(); openResults(ev.id); }}
                    >
                      {t('history.view')}
                    </Button>
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
                    {ev.status === 'failed' && (
                      <Button
                        size='sm'
                        onClick={(e) => { e.stopPropagation(); void handleResume(ev.id); }}
                        disabled={runningEvalId !== null}
                      >
                        {runningEvalId === ev.id ? t('actions.running') : t('actions.resume')}
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
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={(e) => { e.stopPropagation(); void handleDelete(ev.id); }}
                      disabled={deletingEvalId !== null}
                    >
                      {deletingEvalId === ev.id ? t('actions.deleting') : t('actions.delete')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {historyPageCount > 1 && (
              <nav
                className='mt-3 flex flex-wrap items-center justify-center gap-1'
                aria-label={t('history.paginationLabel')}
              >
                <Button
                  size='sm'
                  variant='outline'
                  disabled={activeHistoryPage === 1}
                  onClick={() => setHistoryPage(activeHistoryPage - 1)}
                >
                  ‹
                </Button>
                {buildPageWindow(activeHistoryPage, historyPageCount).map((item, index) =>
                  item === 'ellipsis' ? (
                    <span
                      key={`ellipsis-${index}`}
                      className='px-1 text-sm text-muted-foreground'
                      aria-hidden
                    >
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      size='sm'
                      variant={item === activeHistoryPage ? 'default' : 'outline'}
                      onClick={() => setHistoryPage(item)}
                    >
                      {item}
                    </Button>
                  ),
                )}
                <Button
                  size='sm'
                  variant='outline'
                  disabled={activeHistoryPage === historyPageCount}
                  onClick={() => setHistoryPage(activeHistoryPage + 1)}
                >
                  ›
                </Button>
              </nav>
            )}
          </CardContent>
        </Card>
      )}

      {openResultsId && (
        <EvaluationResultsPanel
          evaluationId={openResultsId}
          status={openResultsEval?.status ?? 'completed'}
          evaluationName={openResultsEval?.name ?? ''}
          data={resultsData}
          loading={resultsLoading}
          error={resultsError}
          onClose={closeResults}
        />
      )}
      </div>
    </div>
  );
}
