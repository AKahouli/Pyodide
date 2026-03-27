/**
 * ReportsPage - View and manage reported messages
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Flag,
  Loader2,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X,
  Eye,
  MessageSquare,
  FileText,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Terminal } from '@/components/ai-elements/terminal';
import { ChatMessageBubble, type ChatMessage } from '@/components/ai-elements/chat-conversation';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import type { MessageComponent } from '@/modules/conversation/types';
import { toast } from 'sonner';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';
import { getReports, getReportById, updateReportStatus, getLogs } from '../api';
import type {
  ReportResponse,
  ReportDetailResponse,
  ReportQueryParams,
  ReportStatus,
  ReportReason,
  LogEntry,
} from '../types';

type AdminTranslate = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;

// Report reason translation keys
const REPORT_REASON_KEYS: Record<ReportReason, ModuleTranslationKey<'admin'>> = {
  inaccurate: 'reports.reasons.inaccurate',
  wrong_information: 'reports.reasons.wrong_information',
  offensive: 'reports.reasons.offensive',
  out_of_context: 'reports.reasons.out_of_context',
  hallucination: 'reports.reasons.hallucination',
  other: 'reports.reasons.other',
};

// Status translation keys
const STATUS_KEYS: Record<ReportStatus, ModuleTranslationKey<'admin'>> = {
  pending: 'reports.status.pending',
  reviewed: 'reports.status.reviewed',
  resolved: 'reports.status.resolved',
};

// Status badge color classes (labels come from translations)
const STATUS_STYLES: Record<ReportStatus, { className: string; labelKey: ModuleTranslationKey<'admin'> }> = {
  pending: { className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', labelKey: 'reports.status.pending' },
  reviewed: { className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', labelKey: 'reports.status.reviewed' },
  resolved: { className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', labelKey: 'reports.status.resolved' },
};

// Format date/time
function formatDateTime(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Format relative time
function formatRelativeTime(dateString: string, translate: AdminTranslate, locale: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return translate('reports.relativeTime.justNow');
  if (diffMins < 60) return translate('reports.relativeTime.minutesAgo', { count: diffMins });
  if (diffHours < 24) return translate('reports.relativeTime.hoursAgo', { count: diffHours });
  if (diffDays < 7) return translate('reports.relativeTime.daysAgo', { count: diffDays });
  return formatDateTime(dateString, locale);
}

// Truncate string for display
function truncateText(text: string, maxLength: number = 80): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// Format logs for Terminal display
function formatLogsForTerminal(logs: LogEntry[], translate: AdminTranslate): string {
  if (logs.length === 0) return translate('reports.sections.logs.empty');

  return logs.map(log => {
    const timestamp = new Date(log.timestamp).toISOString();
    const level = log.level.padEnd(5);
    const context = log.context ? `[${log.context}]` : '';
    const data = log.data ? `\n  ${JSON.stringify(log.data, null, 2)}` : '';
    return `${timestamp} ${level} ${context} ${log.message}${data}`;
  }).join('\n');
}

// Component for rendering user message in report detail
interface ReportUserMessageProps {
  content: string;
  timestamp: string;
  attachedFileIds?: string[];
}

function ReportUserMessage({ content, timestamp, attachedFileIds }: ReportUserMessageProps) {
  const chatMessage: ChatMessage = useMemo(() => ({
    id: 'user-message',
    role: 'user',
    content,
    timestamp: new Date(timestamp),
  }), [content, timestamp]);

  const { t: tAdmin } = useModuleTranslation('admin');

  return (
    <div>
      <ChatMessageBubble message={chatMessage} showAvatar={false} />
      {attachedFileIds && attachedFileIds.length > 0 && (
        <p className="text-xs text-muted-foreground mt-1 text-right mr-2">
          {tAdmin('reports.messages.filesAttached', { count: attachedFileIds.length })}
        </p>
      )}
    </div>
  );
}

// Component for rendering AI message in report detail
interface ReportAiMessageProps {
  components: MessageComponent[];
  timestamp: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  requestId?: string;
}

function ReportAiMessage({ components, timestamp, inputTokens, outputTokens, durationMs, requestId }: ReportAiMessageProps) {
  const chatMessage: ChatMessage = useMemo(() => ({
    id: 'ai-message',
    role: 'assistant',
    content: mapComponentsToContentParts(components),
    timestamp: new Date(timestamp),
  }), [components, timestamp]);

  const { t: tAdmin } = useModuleTranslation('admin');

  return (
    <div>
      <ChatMessageBubble message={chatMessage} showAvatar={false} />
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-2 ml-1">
        {inputTokens !== undefined && (
          <span>{tAdmin('reports.messages.input')}: {inputTokens.toLocaleString()} tokens</span>
        )}
        {outputTokens !== undefined && (
          <span>{tAdmin('reports.messages.output')}: {outputTokens.toLocaleString()} tokens</span>
        )}
        {durationMs !== undefined && (
          <span>{tAdmin('reports.messages.duration')}: {(durationMs / 1000).toFixed(2)}s</span>
        )}
        {requestId && (
          <span className="font-mono">{tAdmin('reports.messages.request')}: {requestId.slice(0, 12)}...</span>
        )}
      </div>
    </div>
  );
}

export function ReportsPage() {
  const { t, language } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit] = useState(20);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [reasonFilter, setReasonFilter] = useState<string>('all');

  // Detail modal state
  const [showDetail, setShowDetail] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ReportDetailResponse | null>(null);
  const formattedTotal = useMemo(() => new Intl.NumberFormat(language ?? 'en').format(total), [total, language]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Status update state
  const [newStatus, setNewStatus] = useState<ReportStatus>('pending');
  const [adminNotes, setAdminNotes] = useState('');
  const [updating, setUpdating] = useState(false);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params: ReportQueryParams = {
        page,
        limit,
        sortOrder: 'desc',
      };

      if (statusFilter !== 'all') params.status = statusFilter as ReportStatus;
      if (reasonFilter !== 'all') params.reason = reasonFilter as ReportReason;

      const result = await getReports(params);
      setReports(result.reports);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reports.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, reasonFilter, t]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleViewReport = async (report: ReportResponse) => {
    setDetailLoading(true);
    setShowDetail(true);
    setSelectedReport(null);
    setLogs([]);

    try {
      const detail = await getReportById(report.id);
      setSelectedReport(detail);
      setNewStatus(detail.status);
      setAdminNotes(detail.adminNotes || '');

      // Fetch logs if requestId is available
      if (detail.aiMessage.requestId) {
        setLogsLoading(true);
        try {
          const logsResult = await getLogs({
            requestId: detail.aiMessage.requestId,
            limit: 100,
            sort: 'asc',
          });
          setLogs(logsResult.data);
        } catch (err) {
          console.error('Failed to fetch logs:', err);
        } finally {
          setLogsLoading(false);
        }
      }
    } catch (err) {
      toast.error(t('reports.toasts.loadError.title'), {
        description: err instanceof Error ? err.message : t('reports.errors.unknown'),
      });
      setShowDetail(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedReport) return;

    setUpdating(true);
    try {
      await updateReportStatus(selectedReport.id, {
        status: newStatus,
        adminNotes: adminNotes || undefined,
      });
      toast.success(t('reports.toasts.statusUpdated.title'));

      // Update the report in the list
      setReports(prev =>
        prev.map(r =>
          r.id === selectedReport.id
            ? { ...r, status: newStatus, adminNotes }
            : r
        )
      );

      // Update selected report
      setSelectedReport(prev =>
        prev ? { ...prev, status: newStatus, adminNotes } : null
      );
    } catch (err) {
      toast.error(t('reports.toasts.updateError.title'), {
        description: err instanceof Error ? err.message : t('reports.errors.unknown'),
      });
    } finally {
      setUpdating(false);
    }
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setReasonFilter('all');
    setPage(1);
  };

  const hasActiveFilters = statusFilter !== 'all' || reasonFilter !== 'all';

  if (error && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={fetchReports} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          {tCommon('actionRetry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('reports.title')}</h1>
          <p className="text-muted-foreground">{t('reports.description')}</p>
        </div>
        <Button onClick={fetchReports} variant="outline" size="icon">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex gap-2 flex-wrap">
              <div className="flex flex-col gap-2">
                <Label>{t('reports.filters.status.label')}</Label>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder={t('reports.filters.status.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('reports.filters.status.all')}</SelectItem>
                    <SelectItem value="pending">{t('reports.filters.status.pending')}</SelectItem>
                    <SelectItem value="reviewed">{t('reports.filters.status.reviewed')}</SelectItem>
                    <SelectItem value="resolved">{t('reports.filters.status.resolved')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('reports.filters.reason.label')}</Label>
                <Select
                  value={reasonFilter}
                  onValueChange={(value) => {
                    setReasonFilter(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t('reports.filters.reason.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('reports.filters.reason.all')}</SelectItem>
                    {Object.entries(REPORT_REASON_KEYS).map(([value, labelKey]) => (
                      <SelectItem key={value} value={value}>
                        {t(labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters && (
                <div className="flex items-end">
                  <Button variant="ghost" onClick={clearFilters}>
                    <X className="mr-1 h-4 w-4" />
                    {t('reports.filters.clear')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reports Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Flag className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{t('reports.table.title')}</CardTitle>
              <CardDescription>
                {loading ? t('reports.table.loading') : t('reports.table.total', { count: total, formattedCount: formattedTotal })}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">{t('reports.table.columns.reporter')}</TableHead>
                  <TableHead className="w-[140px]">{t('reports.table.columns.reason')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('reports.table.columns.description')}</TableHead>
                  <TableHead className="w-[100px]">{t('reports.table.columns.status')}</TableHead>
                  <TableHead className="w-[140px] hidden lg:table-cell">{t('reports.table.columns.date')}</TableHead>
                  <TableHead className="w-[80px] text-right">{t('reports.table.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : reports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      {t('reports.table.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  reports.map((report) => {
                    const statusStyle = STATUS_STYLES[report.status];
                    return (
                      <TableRow key={report.id} className="cursor-pointer hover:bg-muted/50">
                        <TableCell>
                          <span className="text-sm font-medium truncate block max-w-[160px]">
                            {report.userId.slice(0, 8)}...
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {t(REPORT_REASON_KEYS[report.reason])}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="text-sm text-muted-foreground">
                            {truncateText(report.description)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusStyle.className}>
                            {t(statusStyle.labelKey)}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <div className="flex flex-col">
                            <span className="text-sm">{formatRelativeTime(report.createdAt, t, language)}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(report.createdAt, language)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewReport(report)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
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
            <div className="flex items-center justify-between px-2 py-4">
              <p className="text-sm text-muted-foreground">
                {t('reports.pagination.summary', {
                  page,
                  total: totalPages,
                  count: total,
                  formattedCount: formattedTotal
                })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t('reports.pagination.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  {t('reports.pagination.next')}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="h-5 w-5" />
              {t('reports.dialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('reports.dialog.description')}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : selectedReport ? (
            <div className="space-y-6">
              {/* Report Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {t('reports.sections.information.title')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">{t('reports.sections.information.fields.reason')}:</span>
                      <p className="font-medium">{t(REPORT_REASON_KEYS[selectedReport.reason])}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('reports.sections.information.fields.status')}:</span>
                      <p>
                        <Badge className={STATUS_STYLES[selectedReport.status].className}>
                          {t(STATUS_STYLES[selectedReport.status].labelKey)}
                        </Badge>
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('reports.sections.information.fields.reporter')}:</span>
                      <p className="font-medium truncate">{selectedReport.reporter.email}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('reports.sections.information.fields.reported')}:</span>
                      <p className="font-medium">{formatDateTime(selectedReport.createdAt, language)}</p>
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-sm">{t('reports.sections.information.fields.description')}:</span>
                    <p className="text-sm mt-1 bg-muted/50 p-3 rounded-md">{selectedReport.description}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Conversation Messages */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    {t('reports.sections.conversation.title')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* User Message */}
                    <ReportUserMessage
                      content={selectedReport.userMessage.content}
                      timestamp={selectedReport.userMessage.createdAt}
                      attachedFileIds={selectedReport.userMessage.attachedFileIds}
                    />

                    {/* AI Response */}
                    <ReportAiMessage
                      components={selectedReport.aiMessage.components as MessageComponent[]}
                      timestamp={selectedReport.aiMessage.createdAt}
                      inputTokens={selectedReport.aiMessage.inputTokens}
                      outputTokens={selectedReport.aiMessage.outputTokens}
                      durationMs={selectedReport.aiMessage.durationMs}
                      requestId={selectedReport.aiMessage.requestId}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Logs */}
              {selectedReport.aiMessage.requestId && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" />
                      {t('reports.sections.logs.title')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Terminal
                      output={formatLogsForTerminal(logs, t)}
                      isStreaming={logsLoading}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Status Update */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t('reports.sections.update.title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="status">{t('reports.sections.update.fields.status')}</Label>
                    <Select
                      value={newStatus}
                      onValueChange={(value) => setNewStatus(value as ReportStatus)}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">{t('reports.status.pending')}</SelectItem>
                        <SelectItem value="reviewed">{t('reports.status.reviewed')}</SelectItem>
                        <SelectItem value="resolved">{t('reports.status.resolved')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="admin-notes">{t('reports.sections.update.fields.adminNotes')}</Label>
                    <Textarea
                      id="admin-notes"
                      placeholder={t('reports.sections.update.fields.adminNotesPlaceholder')}
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <Button
                    onClick={handleUpdateStatus}
                    disabled={updating}
                  >
                    {updating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {updating ? t('reports.sections.update.actions.saving') : t('reports.sections.update.actions.save')}
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
