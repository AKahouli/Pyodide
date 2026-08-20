import { useCallback, useEffect, useState } from 'react';
import { RefreshCwIcon, DatabaseIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { conversationV2Api, type AppDataOwnerStatus } from '../../api';
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

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await conversationV2Api.getAppDataStatus(sessionId);
      setStatus(next);
      if (!next.enabled) {
        setError(t('appData.disabled'));
        return;
      }
      const tableRes = await conversationV2Api.getAppDataTables(sessionId, environment);
      setTables(tableRes.tables);
      setSelectedTable((prev) => prev ?? tableRes.tables[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('appData.loadError'));
    } finally {
      setLoading(false);
    }
  }, [sessionId, environment, t]);

  const loadRows = useCallback(async () => {
    if (!selectedTable) {
      setRows([]);
      return;
    }
    try {
      const res = await conversationV2Api.getAppDataRows(sessionId, environment, selectedTable);
      setRows(res.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('appData.loadError'));
    }
  }, [sessionId, environment, selectedTable, t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const envClass = (active: boolean) =>
    cn(
      'rounded-md px-2 py-1 text-xs font-medium',
      active ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
    );

  if (loading && !status) {
    return <div className='flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground'>{t('appData.loading')}</div>;
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
        <div className='inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5'>
          <button type='button' className={envClass(environment === 'dev')} onClick={() => setEnvironment('dev')}>
            DEV
          </button>
          <button type='button' className={envClass(environment === 'prod')} onClick={() => setEnvironment('prod')}>
            PROD
          </button>
        </div>
        <Button variant='ghost' size='icon-sm' aria-label={t('appData.refresh')} onClick={() => void loadStatus()}>
          <RefreshCwIcon className='size-4' />
        </Button>
      </div>

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
