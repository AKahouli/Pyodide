/**
 * LogsPage - View and filter system application logs
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollText, Loader2, AlertCircle, RefreshCw, Search, ChevronLeft, ChevronRight, X, Calendar, Filter, ChevronDown, Play, Pause } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { getLogs, getLogContexts, getLogCounts } from '../api';
import type { LogEntry, LogQueryParams } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

type AdminTranslate = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;

// Auto-refresh interval in milliseconds
const AUTO_REFRESH_INTERVAL = 5000;

// Format relative time
function formatRelativeTime(dateString: string, translate: AdminTranslate, locale: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffSecs < 10) return translate('logs.relativeTime.justNow');
  if (diffSecs < 60) return translate('logs.relativeTime.secondsAgo', { count: diffSecs });
  if (diffMins < 60) return translate('logs.relativeTime.minutesAgo', { count: diffMins });
  if (diffHours < 24) return translate('logs.relativeTime.hoursAgo', { count: diffHours });
  if (diffDays < 7) return translate('logs.relativeTime.daysAgo', { count: diffDays });
  return new Date(dateString).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Get level badge variant and color
function getLevelStyle(level: string): { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string } {
  switch (level) {
    case 'ERROR':
      return { variant: 'destructive', className: 'bg-red-500' };
    case 'WARN':
      return { variant: 'default', className: 'bg-yellow-500 text-black' };
    case 'INFO':
      return { variant: 'default', className: 'bg-blue-500' };
    case 'DEBUG':
      return { variant: 'secondary', className: 'bg-gray-500' };
    case 'VERBOSE':
      return { variant: 'outline', className: 'bg-purple-500 text-white' };
    default:
      return { variant: 'secondary', className: '' };
  }
}

// Format data object for display
function formatData(data?: Record<string, unknown>): string | null {
  if (!data || Object.keys(data).length === 0) return null;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return null;
  }
}

// Truncate string for display
function truncateMessage(message: string, maxLength: number = 100): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength) + '...';
}

export function LogsPage() {
  const { t, language } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  // Filters
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [contextFilter, setContextFilter] = useState<string>('all');
  const [messageSearch, setMessageSearch] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [requestIdFilter, setRequestIdFilter] = useState('');
  const [requestIdInput, setRequestIdInput] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();

  // Filter options
  const [contexts, setContexts] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Expanded row for viewing data
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const formatRelativeTimeLocalized = useCallback((dateString: string) => formatRelativeTime(dateString, t, language), [t, language]);

  const fetchLogs = useCallback(async () => {
    if (!autoRefresh) {
      setLoading(true);
    }
    setError(null);

    try {
      const params: LogQueryParams = {
        page,
        limit,
        sort: 'desc',
      };

      if (levelFilter !== 'all') params.level = levelFilter;
      if (contextFilter !== 'all') params.context = contextFilter;
      if (messageSearch) params.message = messageSearch;
      if (requestIdFilter) params.requestId = requestIdFilter;
      if (startDate) params.from = startDate.toISOString();
      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        params.to = endOfDay.toISOString();
      }

      const result = await getLogs(params);
      setLogs(result.data);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [page, limit, levelFilter, contextFilter, messageSearch, requestIdFilter, startDate, endDate, autoRefresh]);

  const fetchContexts = async () => {
    try {
      const data = await getLogContexts();
      setContexts(data);
    } catch (err) {
      console.error('Failed to load contexts', err);
    }
  };

  const fetchCounts = async () => {
    try {
      const data = await getLogCounts();
      setCounts(data);
    } catch (err) {
      console.error('Failed to load counts', err);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchContexts();
    fetchCounts();
  }, []);

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(() => {
        fetchLogs();
        fetchCounts();
      }, AUTO_REFRESH_INTERVAL);
    } else {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefresh, fetchLogs]);

  const handleSearch = () => {
    setMessageSearch(messageInput);
    setRequestIdFilter(requestIdInput);
    setPage(1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const clearFilters = () => {
    setMessageInput('');
    setMessageSearch('');
    setRequestIdInput('');
    setRequestIdFilter('');
    setLevelFilter('all');
    setContextFilter('all');
    setStartDate(undefined);
    setEndDate(undefined);
    setPage(1);
  };

  const hasActiveFilters = messageSearch || requestIdFilter || levelFilter !== 'all' || contextFilter !== 'all' || startDate || endDate;

  const totalLogs = Object.values(counts).reduce((a, b) => a + b, 0);

  if (error && !loading) {
    return (
      <div className='flex flex-col items-center justify-center h-96 gap-4'>
        <AlertCircle className='h-12 w-12 text-destructive' />
        <p className='text-muted-foreground'>{error}</p>
        <Button onClick={fetchLogs} variant='outline'>
          <RefreshCw className='mr-2 h-4 w-4' />
          {tCommon('actionRetry')}
        </Button>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>{t('logs.title')}</h1>
          <p className='text-muted-foreground'>{t('logs.description')}</p>
        </div>
        <div className='flex items-center gap-2'>
          <Button onClick={() => setAutoRefresh(!autoRefresh)} variant={autoRefresh ? 'default' : 'outline'} size='sm'>
            {autoRefresh ? (
              <>
                <Pause className='mr-1 h-4 w-4' />
                {t('logs.actions.live')}
              </>
            ) : (
              <>
                <Play className='mr-1 h-4 w-4' />
                {t('logs.actions.live')}
              </>
            )}
          </Button>
          <Button onClick={fetchLogs} variant='outline' size='icon' aria-label={t('logs.actions.refresh')}>
            <RefreshCw className='h-4 w-4' />
          </Button>
        </div>
      </div>

      {/* Level counts */}
      <div className='flex flex-wrap gap-2'>
        {['ERROR', 'WARN', 'INFO', 'DEBUG', 'VERBOSE'].map((level) => {
          const count = counts[level] || 0;
          const style = getLevelStyle(level);
          return (
            <Badge
              key={level}
              className={`${style.className} cursor-pointer`}
              onClick={() => {
                setLevelFilter(levelFilter === level ? 'all' : level);
                setPage(1);
              }}>
              {level}: {count.toLocaleString()}
            </Badge>
          );
        })}
        <Badge variant='outline' className='cursor-default'>
          {t('logs.counts.total')}: {totalLogs.toLocaleString()}
        </Badge>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className='pt-6'>
          {/* Primary filters row */}
          <div className='flex flex-col gap-4 md:flex-row md:items-end'>
            <div className='flex-1'>
              <Label htmlFor='message-search' className='sr-only'>
                {t('logs.filters.searchPlaceholder')}
              </Label>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                <Input id='message-search' placeholder={t('logs.filters.searchPlaceholder')} className='pl-9' value={messageInput} onChange={(e) => setMessageInput(e.target.value)} onKeyDown={handleSearchKeyDown} />
              </div>
            </div>
            <div className='flex gap-2 flex-wrap'>
              <Select
                value={levelFilter}
                onValueChange={(value) => {
                  setLevelFilter(value);
                  setPage(1);
                }}>
                <SelectTrigger className='w-[120px]'>
                  <SelectValue placeholder={t('logs.filters.level.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>{t('logs.filters.level.all')}</SelectItem>
                  <SelectItem value='ERROR'>{t('logs.filters.level.error')}</SelectItem>
                  <SelectItem value='WARN'>{t('logs.filters.level.warn')}</SelectItem>
                  <SelectItem value='INFO'>{t('logs.filters.level.info')}</SelectItem>
                  <SelectItem value='DEBUG'>{t('logs.filters.level.debug')}</SelectItem>
                  <SelectItem value='VERBOSE'>{t('logs.filters.level.verbose')}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={contextFilter}
                onValueChange={(value) => {
                  setContextFilter(value);
                  setPage(1);
                }}>
                <SelectTrigger className='w-[180px]'>
                  <SelectValue placeholder={t('logs.filters.context.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>{t('logs.filters.context.all')}</SelectItem>
                  {contexts.map((ctx) => (
                    <SelectItem key={ctx} value={ctx}>
                      {ctx}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleSearch}>{t('logs.filters.search')}</Button>
              {hasActiveFilters && (
                <Button variant='ghost' onClick={clearFilters}>
                  <X className='mr-1 h-4 w-4' />
                  {t('logs.filters.clear')}
                </Button>
              )}
            </div>
          </div>

          {/* Advanced filters */}
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} className='mt-4'>
            <CollapsibleTrigger asChild>
              <Button variant='ghost' size='sm' className='gap-1'>
                <Filter className='h-4 w-4' />
                {t('logs.filters.advanced')}
                <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className='pt-4'>
              <div className='flex flex-wrap gap-4'>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='request-id'>{t('logs.filters.requestId.label')}</Label>
                  <Input id='request-id' placeholder={t('logs.filters.requestId.placeholder')} className='w-[220px]' value={requestIdInput} onChange={(e) => setRequestIdInput(e.target.value)} onKeyDown={handleSearchKeyDown} />
                </div>
                <div className='flex flex-col gap-2'>
                  <Label>{t('logs.filters.startDate')}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant='outline' className='w-[180px] justify-start'>
                        <Calendar className='mr-2 h-4 w-4' />
                        {startDate ? startDate.toLocaleDateString() : t('logs.filters.selectDate')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='w-auto p-0' align='start'>
                      <CalendarComponent
                        mode='single'
                        selected={startDate}
                        onSelect={(date) => {
                          setStartDate(date);
                          setPage(1);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className='flex flex-col gap-2'>
                  <Label>{t('logs.filters.endDate')}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant='outline' className='w-[180px] justify-start'>
                        <Calendar className='mr-2 h-4 w-4' />
                        {endDate ? endDate.toLocaleDateString() : t('logs.filters.selectDate')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='w-auto p-0' align='start'>
                      <CalendarComponent
                        mode='single'
                        selected={endDate}
                        onSelect={(date) => {
                          setEndDate(date);
                          setPage(1);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'>
              <ScrollText className='h-5 w-5' />
            </div>
            <div>
              <CardTitle>{t('logs.table.title')}</CardTitle>
              <CardDescription>
                {loading ? t('logs.table.loading') : t('logs.table.total', { count: total })}
                {autoRefresh && <span className='ml-2 text-green-500'>{t('logs.table.liveUpdates')}</span>}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[140px]'>{t('logs.table.columns.time')}</TableHead>
                  <TableHead className='w-[90px]'>{t('logs.table.columns.level')}</TableHead>
                  <TableHead className='w-[150px] hidden md:table-cell'>{t('logs.table.columns.context')}</TableHead>
                  <TableHead>{t('logs.table.columns.message')}</TableHead>
                  <TableHead className='w-[100px] hidden lg:table-cell'>{t('logs.table.columns.requestId')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !autoRefresh ? (
                  <TableRow>
                    <TableCell colSpan={5} className='h-24 text-center'>
                      <Loader2 className='h-6 w-6 animate-spin mx-auto' />
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className='h-24 text-center'>
                      {t('logs.table.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => {
                    const style = getLevelStyle(log.level);
                    const data = formatData(log.data);
                    const isExpanded = expandedRow === log._id;

                    return (
                      <>
                        <TableRow
                          key={log._id || log.timestamp}
                          className={`cursor-pointer hover:bg-muted/50 ${data ? '' : 'cursor-default'}`}
                          onClick={() => {
                            if (data) {
                              setExpandedRow(isExpanded ? null : log._id || null);
                            }
                          }}>
                          <TableCell>
                            <div className='flex flex-col'>
                              <span className='text-sm font-medium'>{formatRelativeTimeLocalized(log.timestamp)}</span>
                              <span className='text-xs text-muted-foreground'>{new Date(log.timestamp).toLocaleString(language)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${style.className} text-xs`}>{log.level}</Badge>
                            {log._fromBuffer && <span className='ml-1 text-xs text-muted-foreground'>{t('logs.table.buffer')}</span>}
                          </TableCell>
                          <TableCell className='hidden md:table-cell'>
                            <span className='text-sm font-mono'>{log.context || '-'}</span>
                          </TableCell>
                          <TableCell>
                            <div className='flex flex-col gap-1'>
                              <span className='text-sm'>{truncateMessage(log.message, 120)}</span>
                              {data && <span className='text-xs text-muted-foreground'>{isExpanded ? t('logs.table.collapse') : t('logs.table.expand')}</span>}
                            </div>
                          </TableCell>
                          <TableCell className='hidden lg:table-cell'>
                            {log.requestId ? (
                              <span
                                className='text-xs font-mono text-blue-500 cursor-pointer hover:underline'
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRequestIdInput(log.requestId || '');
                                  setRequestIdFilter(log.requestId || '');
                                  setPage(1);
                                }}>
                                {log.requestId.slice(0, 12)}...
                              </span>
                            ) : (
                              <span className='text-muted-foreground'>-</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {isExpanded && data && (
                          <TableRow>
                            <TableCell colSpan={5} className='bg-muted/30'>
                              <pre className='text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 bg-muted rounded'>{data}</pre>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className='flex items-center justify-between px-2 py-4'>
              <p className='text-sm text-muted-foreground'>
                {t('logs.pagination.summary', { page, total: totalPages, totalEntries: total })}
              </p>
              <div className='flex gap-2'>
                <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className='h-4 w-4' />
                  {t('logs.pagination.previous')}
                </Button>
                <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  {t('logs.pagination.next')}
                  <ChevronRight className='h-4 w-4' />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
