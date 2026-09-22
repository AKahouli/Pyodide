import { useEffect, useState } from 'react';
import { RefreshCwIcon, DatabaseIcon, SproutIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { conversationV2Api, type AppDataOwnerStatus, type SeedResult } from '../../api';
import { useConversationV2Translation } from '../../translation';

type Environment = 'dev' | 'prod';

interface AppDataPanelProps {
  sessionId: string;
}

export function AppDataPanel({ sessionId }: AppDataPanelProps) {
  const { t } = useConversationV2Translation();
  const [status, setStatus] = useState<AppDataOwnerStatus | null>(null);
  const [environment, setEnvironment] = useState<Environment>('dev');
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [seedOpen, setSeedOpen] = useState(false);
  const [seedText, setSeedText] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const next = await conversationV2Api.getAppDataStatus(sessionId);
        if (cancelled) return;
        setStatus(next);
        if (!next.enabled) {
          setError(t('appData.disabled'));
          return;
        }
        const tableRes = await conversationV2Api.getAppDataTables(sessionId, environment);
        if (cancelled) return;
        setTables(tableRes.tables);
        setSelectedTable((prev) => prev ?? tableRes.tables[0] ?? null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : t('appData.loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, environment, t, refreshNonce]);

  useEffect(() => {
    if (!selectedTable) {
      setRows([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await conversationV2Api.getAppDataRows(sessionId, environment, selectedTable);
        if (cancelled) return;
        setRows(res.rows);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : t('appData.loadError'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, environment, selectedTable, t]);

  const envClass = (active: boolean) =>
    cn(
      'rounded-md px-2 py-1 text-xs font-medium',
      active ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
    );

  const applySeed = async () => {
    setSeedError(null);
    setSeedResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(seedText);
    } catch {
      setSeedError(t('appData.seedInvalidJson'));
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setSeedError(t('appData.seedInvalidJson'));
      return;
    }
    const tablesPayload = parsed as Record<string, Record<string, unknown>[]>;
    if (Object.keys(tablesPayload).length === 0) {
      setSeedError(t('appData.seedInvalidJson'));
      return;
    }
    setSeeding(true);
    try {
      const result = await conversationV2Api.seedAppData(sessionId, environment, tablesPayload);
      setSeedResult(result);
      setRefreshNonce((n) => n + 1);
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : t('appData.seedError'));
    } finally {
      setSeeding(false);
    }
  };

  if (loading && !status) {
    return <div className='flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground'>{t('appData.loading')}</div>;
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
        <div className='inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5'>
          <button type='button' className={envClass(environment === 'dev')} onClick={() => setEnvironment('dev')}>
            {t('appData.envDev')}
          </button>
          <button type='button' className={envClass(environment === 'prod')} onClick={() => setEnvironment('prod')}>
            {t('appData.envProd')}
          </button>
        </div>
        <div className='inline-flex items-center gap-1'>
          {environment === 'dev' && (
            <Button
              variant='ghost'
              size='sm'
              className='gap-1 text-xs'
              disabled={!status?.appDataId || seeding}
              onClick={() => setSeedOpen((o) => !o)}
            >
              <SproutIcon className='size-4' />
              {t('appData.seed')}
            </Button>
          )}
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('appData.refresh')}
            onClick={() => setRefreshNonce((n) => n + 1)}
          >
            <RefreshCwIcon className='size-4' />
          </Button>
        </div>
      </div>

      {seedOpen && environment === 'dev' && (
        <div className='border-b px-3 py-2'>
          <textarea
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            rows={6}
            placeholder={t('appData.seedPlaceholder')}
            className='w-full rounded border bg-muted/40 p-2 font-mono text-xs outline-none focus:border-ring'
          />
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            <Button type='button' size='sm' disabled={seeding} onClick={applySeed}>
              {seeding ? t('appData.seeding') : t('appData.seedApply')}
            </Button>
            {seedError && <span className='text-xs text-destructive'>{seedError}</span>}
            {seedResult && (
              <span className='text-xs text-muted-foreground'>
                {t('appData.seedDone', { inserted: seedResult.inserted, skipped: seedResult.skipped })}
              </span>
            )}
          </div>
        </div>
      )}

      {error ? (
        <div className='p-4 text-sm text-destructive'>{error}</div>
      ) : (
        <>
          <div className='border-b px-3 py-2 text-xs text-muted-foreground'>
            <div className='flex items-center gap-1.5 font-medium text-foreground'>
              <DatabaseIcon className='size-3.5' />
              {status?.appDataId ?? '—'}
            </div>
            <div>
              {t('appData.schemaVersion')}:{' '}
              {environment === 'dev' ? status?.dev.currentVersion : status?.prod.currentVersion}
            </div>
          </div>

          <div className='flex min-h-0 flex-1 overflow-hidden'>
            <aside className='w-40 shrink-0 overflow-y-auto border-r p-2'>
              {tables.length === 0 ? (
                <p className='px-1 text-xs text-muted-foreground'>{t('appData.noTables')}</p>
              ) : (
                tables.map((table) => (
                  <button
                    key={table}
                    type='button'
                    className={cn(
                      'mb-1 w-full truncate rounded px-2 py-1 text-left text-xs',
                      selectedTable === table ? 'bg-muted font-medium' : 'hover:bg-muted/60',
                    )}
                    onClick={() => setSelectedTable(table)}
                  >
                    {table}
                  </button>
                ))
              )}
            </aside>
            <div className='min-w-0 flex-1 overflow-auto p-2'>
              <pre className='whitespace-pre-wrap break-all text-xs'>{JSON.stringify(rows, null, 2)}</pre>
            </div>
          </div>
        </>
      )}
    </div>
  );
}