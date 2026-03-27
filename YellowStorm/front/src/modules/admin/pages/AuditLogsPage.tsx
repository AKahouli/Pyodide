/**
 * AuditLogsPage - View and filter system audit logs
 */

import { useEffect, useState, useCallback } from 'react';
import { FileText, Loader2, AlertCircle, RefreshCw, Search, ChevronLeft, ChevronRight, CheckCircle2, XCircle, X, Calendar, Filter, ChevronDown } from 'lucide-react';

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
import { getAuditLogs, getAuditLogFeatures } from '../api';
import type { AuditLogResponse, AuditLogQueryParams, AuditLogStatus } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

type AdminTranslate = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;

// Format date/time
function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Format relative time
function formatRelativeTime(dateString: string, t: AdminTranslate): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return t('auditLogs.relativeTime.justNow');
  if (diffMins < 60) return t('auditLogs.relativeTime.minutes', { count: diffMins });
  if (diffHours < 24) return t('auditLogs.relativeTime.hours', { count: diffHours });
  if (diffDays < 7) return t('auditLogs.relativeTime.days', { count: diffDays });
  return formatDateTime(dateString);
}

// Parse action into feature and action name
function parseAction(action: string): { feature: string; actionName: string } {
  const parts = action.split('.');
  if (parts.length >= 2) {
    return {
      feature: parts[0],
      actionName: parts.slice(1).join('.'),
    };
  }
  return { feature: action, actionName: action };
}

// Get feature badge color
function getFeatureColor(feature: string): string {
  const colors: Record<string, string> = {
    users: 'bg-blue-500',
    roles: 'bg-purple-500',
    plans: 'bg-green-500',
    system: 'bg-orange-500',
    workspace: 'bg-cyan-500',
    auth: 'bg-yellow-500',
  };
  return colors[feature.toLowerCase()] || 'bg-gray-500';
}

// Format a single value for display
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(formatValue).join(', ');
  }
  if (typeof value === 'object') {
    // For nested objects, format key-value pairs
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${formatValue(v)}`);
    return entries.length > 0 ? `{${entries.join(', ')}}` : '';
  }
  return String(value);
}

// Format metadata as readable text
function formatMetadata(metadata?: Record<string, unknown>): string | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;

  const parts: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null) {
      const formatted = formatValue(value);
      if (formatted) {
        parts.push(`${key}: ${formatted}`);
      }
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

export function AuditLogsPage() {
  const { t } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AuditLogResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  // Filters
  const [emailSearch, setEmailSearch] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<AuditLogStatus | 'all'>('all');
  const [featureFilter, setFeatureFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();

  // Filter options
  const [features, setFeatures] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params: AuditLogQueryParams = {
        limit,
        skip: (page - 1) * limit,
      };

      if (emailSearch) params.actorEmail = emailSearch;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (featureFilter !== 'all') params.feature = featureFilter;
      if (startDate) params.startDate = startDate.toISOString();
      if (endDate) {
        // Set end date to end of day
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        params.endDate = endOfDay.toISOString();
      }

      const data = await getAuditLogs(params);
      setLogs(data.logs);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auditLogs.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [page, limit, emailSearch, statusFilter, featureFilter, startDate, endDate, t]);

  const fetchFeatures = useCallback(async () => {
    try {
      const data = await getAuditLogFeatures();
      setFeatures(data);
    } catch (err) {
      console.error(t('auditLogs.errors.features'), err);
    }
  }, [t]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  const handleSearch = () => {
    setEmailSearch(emailInput);
    setPage(1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const clearFilters = () => {
    setEmailInput('');
    setEmailSearch('');
    setStatusFilter('all');
    setFeatureFilter('all');
    setStartDate(undefined);
    setEndDate(undefined);
    setPage(1);
  };

  const hasActiveFilters = emailSearch || statusFilter !== 'all' || featureFilter !== 'all' || startDate || endDate;

  const totalPages = Math.ceil(total / limit);

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
          <h1 className='text-2xl font-bold tracking-tight'>{t('auditLogs.title')}</h1>
          <p className='text-muted-foreground'>{t('auditLogs.description')}</p>
        </div>
        <Button onClick={fetchLogs} variant='outline' size='icon' aria-label={t('auditLogs.actions.refresh')}>
          <RefreshCw className='h-4 w-4' />
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className='pt-6'>
          {/* Primary filters row */}
          <div className='flex flex-col gap-4 md:flex-row md:items-end'>
            <div className='flex-1'>
              <Label htmlFor='email-search' className='sr-only'>
                {t('auditLogs.filters.searchLabel')}
              </Label>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                <Input id='email-search' placeholder={t('auditLogs.filters.searchPlaceholder')} className='pl-9' value={emailInput} onChange={(e) => setEmailInput(e.target.value)} onKeyDown={handleSearchKeyDown} />
              </div>
            </div>
            <div className='flex gap-2 flex-wrap'>
              <Select
                value={featureFilter}
                onValueChange={(value) => {
                  setFeatureFilter(value);
                  setPage(1);
                }}>
                <SelectTrigger className='w-[140px]'>
                  <SelectValue placeholder={t('auditLogs.filters.feature.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>{t('auditLogs.filters.feature.all')}</SelectItem>
                  {features.map((feature) => (
                    <SelectItem key={feature} value={feature}>
                      {feature.charAt(0).toUpperCase() + feature.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as AuditLogStatus | 'all');
                  setPage(1);
                }}>
                <SelectTrigger className='w-[120px]'>
                  <SelectValue placeholder={t('auditLogs.filters.status.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>{t('auditLogs.filters.status.all')}</SelectItem>
                  <SelectItem value='success'>{t('auditLogs.status.success')}</SelectItem>
                  <SelectItem value='failure'>{t('auditLogs.status.failure')}</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleSearch}>{t('auditLogs.actions.search')}</Button>
              {hasActiveFilters && (
                <Button variant='ghost' onClick={clearFilters}>
                  <X className='mr-1 h-4 w-4' />
                  {t('auditLogs.actions.clear')}
                </Button>
              )}
            </div>
          </div>

          {/* Advanced filters */}
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} className='mt-4'>
            <CollapsibleTrigger asChild>
              <Button variant='ghost' size='sm' className='gap-1'>
                <Filter className='h-4 w-4' />
                {t('auditLogs.filters.advanced')}
                <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className='pt-4'>
              <div className='flex flex-wrap gap-4'>
                <div className='flex flex-col gap-2'>
                  <Label>{t('auditLogs.filters.startDate')}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant='outline' className='w-[180px] justify-start'>
                        <Calendar className='mr-2 h-4 w-4' />
                        {startDate ? startDate.toLocaleDateString() : t('auditLogs.filters.selectDate')}
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
                  <Label>{t('auditLogs.filters.endDate')}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant='outline' className='w-[180px] justify-start'>
                        <Calendar className='mr-2 h-4 w-4' />
                        {endDate ? endDate.toLocaleDateString() : t('auditLogs.filters.selectDate')}
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
              <FileText className='h-5 w-5' />
            </div>
            <div>
              <CardTitle>{t('auditLogs.table.title')}</CardTitle>
              <CardDescription>{loading ? tCommon('actionLoading') : t('auditLogs.table.total', { count: total })}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[140px]'>{t('auditLogs.table.columns.time')}</TableHead>
                  <TableHead>{t('auditLogs.table.columns.actor')}</TableHead>
                  <TableHead>{t('auditLogs.table.columns.action')}</TableHead>
                  <TableHead className='hidden lg:table-cell'>{t('auditLogs.table.columns.details')}</TableHead>
                  <TableHead className='w-[100px]'>{t('auditLogs.table.columns.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className='h-24 text-center'>
                      <Loader2 className='h-6 w-6 animate-spin mx-auto' />
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className='h-24 text-center'>
                      {t('auditLogs.table.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => {
                    const { feature, actionName } = parseAction(log.action);
                    const metadataText = formatMetadata(log.metadata);

                    return (
                      <TableRow key={log.id}>
                        <TableCell>
                          <div className='flex flex-col'>
                            <span className='text-sm font-medium'>{formatRelativeTime(log.createdAt, t)}</span>
                            <span className='text-xs text-muted-foreground'>{formatDateTime(log.createdAt)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className='flex flex-col'>
                            <span className='font-medium text-sm'>{log.actorEmail}</span>
                            {log.ipAddress && <span className='text-xs text-muted-foreground'>{t('auditLogs.table.ip', { value: log.ipAddress })}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className='flex flex-col gap-1'>
                            <div className='flex items-center gap-2'>
                              <Badge className={`${getFeatureColor(feature)} text-white text-xs`}>{feature}</Badge>
                              <span className='font-medium'>{actionName}</span>
                            </div>
                            {log.targetType && (
                              <span className='text-xs text-muted-foreground'>
                                {log.targetType}
                                {log.targetId && `: ${log.targetId.slice(0, 8)}...`}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className='hidden lg:table-cell'>{log.failureReason ? <span className='text-sm text-destructive'>{log.failureReason}</span> : metadataText ? <span className='text-sm text-muted-foreground line-clamp-2'>{metadataText}</span> : <span className='text-muted-foreground'>-</span>}</TableCell>
                        <TableCell>
                          {log.status === 'success' ? (
                            <div className='flex items-center gap-1 text-green-600'>
                              <CheckCircle2 className='h-4 w-4' />
                              <span className='text-sm'>{t('auditLogs.status.success')}</span>
                            </div>
                          ) : (
                            <div className='flex items-center gap-1 text-destructive'>
                              <XCircle className='h-4 w-4' />
                              <span className='text-sm'>{t('auditLogs.status.failure')}</span>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className='flex items-center justify-between px-2 py-4'>
              <p className='text-sm text-muted-foreground'>{t('auditLogs.pagination.summary', { page, totalPages, total })}</p>
              <div className='flex gap-2'>
                <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className='h-4 w-4' />
                  {t('auditLogs.pagination.previous')}
                </Button>
                <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={!hasMore && page === totalPages}>
                  {t('auditLogs.pagination.next')}
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
