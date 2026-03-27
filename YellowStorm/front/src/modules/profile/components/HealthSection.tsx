/**
 * Health Section
 * Displays backend health metrics and status with charts
 */

import * as React from 'react';
import {
  Activity,
  Database,
  HardDrive,
  Mail,
  Cpu,
  Clock,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import { Area, AreaChart } from 'recharts';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';
import * as profileApi from '../api';
import type {
  HealthCheckResult,
  HealthCheckDetail,
  HealthHistoryResponse,
  HealthHistoryStats,
  HealthHistoryRecord,
} from '../types';

type ProfileTranslate = (key: ModuleTranslationKey<'profile'>, params?: TranslationParams) => string;

const checkIcons: Record<string, React.ReactNode> = {
  memory: <Cpu className="h-4 w-4" />,
  eventLoop: <Activity className="h-4 w-4" />,
  database: <Database className="h-4 w-4" />,
  storage: <HardDrive className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
};

const CHECK_LABEL_KEYS = {
  memory: 'health.checkLabels.memory',
  eventLoop: 'health.checkLabels.eventLoop',
  database: 'health.checkLabels.database',
  storage: 'health.checkLabels.storage',
  email: 'health.checkLabels.email',
} as const;

const serviceColors: Record<string, string> = {
  memory: 'var(--chart-1)',
  eventLoop: 'var(--chart-2)',
  database: 'var(--chart-3)',
  storage: 'var(--chart-4)',
  email: 'var(--chart-5)',
};

const STATUS_LABEL_KEYS = {
  healthy: 'health.statusLabels.healthy',
  degraded: 'health.statusLabels.degraded',
  unhealthy: 'health.statusLabels.unhealthy',
  up: 'health.statusLabels.up',
  down: 'health.statusLabels.down',
  unknown: 'health.statusLabels.unknown',
} as const;

function getStatusColor(status: string) {
  switch (status) {
    case 'healthy':
    case 'up':
      return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'degraded':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'unhealthy':
    case 'down':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'healthy':
    case 'up':
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    case 'degraded':
      return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    case 'unhealthy':
    case 'down':
      return <XCircle className="h-4 w-4 text-red-600" />;
    default:
      return null;
  }
}

function getStatusLabel(status: string, translate: ProfileTranslate) {
  const key = STATUS_LABEL_KEYS[status as keyof typeof STATUS_LABEL_KEYS];
  if (!key) {
    return translate('health.statusLabels.unknown');
  }
  return translate(key);
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${Math.floor(seconds)}s`);

  return parts.join(' ');
}

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ServiceResponseChart({
  data,
  serviceName,
  translate,
}: {
  data: Array<{ time: string; responseTime: number }>;
  serviceName: string;
  translate: ProfileTranslate;
}) {
  const chartConfig: ChartConfig = {
    responseTime: {
      label: translate('health.charts.responseTime'),
      color: serviceColors[serviceName] || 'var(--chart-1)',
    },
  };

  if (data.length < 2) {
    return (
      <div className="h-[60px] flex items-center justify-center text-xs text-muted-foreground">
        {translate('health.charts.collecting')}
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-[60px] w-full">
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
        <defs>
          <linearGradient id={`fill-${serviceName}`} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor={serviceColors[serviceName] || 'var(--chart-1)'}
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor={serviceColors[serviceName] || 'var(--chart-1)'}
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="responseTime"
          stroke={serviceColors[serviceName] || 'var(--chart-1)'}
          fill={`url(#fill-${serviceName})`}
          strokeWidth={1.5}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                if (payload?.[0]?.payload?.time) {
                  return payload[0].payload.time;
                }
                return '';
              }}
              formatter={(value) => [`${value}ms`, translate('health.charts.responseTime')]}
            />
          }
        />
      </AreaChart>
    </ChartContainer>
  );
}

function UptimeChart({
  stats,
  history,
  translate,
}: {
  stats: HealthHistoryStats | null;
  history: HealthHistoryRecord[] | undefined;
  translate: ProfileTranslate;
}) {
  if (!stats || !history || history.length === 0) {
    return (
      <div className="h-[100px] flex items-center justify-center text-xs text-muted-foreground">
        {translate('health.charts.noHistory')}
      </div>
    );
  }

  const sortedHistory = [...history].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  const getBarColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'up':
        return 'bg-green-500 hover:bg-green-600 rounded-none';
      case 'degraded':
        return 'bg-yellow-500 hover:bg-yellow-600 rounded-none';
      case 'unhealthy':
      case 'down':
        return 'bg-red-500 hover:bg-red-600 rounded-none';
      default:
        return 'bg-muted hover:bg-muted/80 rounded-none';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-green-600" />
          <span className="text-2xl font-bold">{stats.uptimePercentage}%</span>
          <span className="text-sm text-muted-foreground">{translate('health.uptimeLabel')}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs text-muted-foreground font-medium">
            {translate('health.lastMinutes', { minutes: stats.period.minutes })}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {translate('health.checksCount', { count: stats.totalRecords })}
          </span>
        </div>
      </div>

      <TooltipProvider>
        <div className="flex h-12 w-full items-end gap-[1px]">
          {sortedHistory.map((record) => (
            <Tooltip key={record._id}>
              <TooltipTrigger asChild>
                <div
                  className={`flex-1 h-8 transition-all cursor-pointer  ${getBarColor(
                    record.status
                  )}`}
                />
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="flex flex-col gap-1 p-2 text-xs"
              >
                <div className="font-semibold">
                  {new Date(record.recordedAt).toLocaleString()}
                </div>
                <div className="flex items-center gap-1.5">
                  {getStatusIcon(record.status)}
                  <span>{getStatusLabel(record.status, translate)}</span>
                </div>
                {record.status !== 'healthy' && (
                  <div className="text-muted-foreground mt-1 max-w-[200px]">
                    {translate('health.charts.details')}
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>

      <div className="flex justify-between text-xs text-muted-foreground pt-1">
        <span>{translate('health.historyRangeStart', { minutes: stats.period.minutes })}</span>
        <span>{translate('health.historyRangeEnd')}</span>
      </div>

      <div className="flex gap-4 text-xs mt-2 justify-center">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-muted-foreground">{translate('health.legend.healthy')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-yellow-500" />
          <span className="text-muted-foreground">{translate('health.legend.degraded')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-muted-foreground">{translate('health.legend.unhealthy')}</span>
        </div>
      </div>
    </div>
  );
}

function HealthCheckCard({
  name,
  detail,
  historyData,
  avgResponseTime,
  translate,
}: {
  name: string;
  detail: HealthCheckDetail;
  historyData: Array<{ time: string; responseTime: number }>;
  avgResponseTime?: number;
  translate: ProfileTranslate;
}) {
  const icon = checkIcons[name] || <Activity className="h-4 w-4" />;
  const labelKey = CHECK_LABEL_KEYS[name as keyof typeof CHECK_LABEL_KEYS];
  const label = labelKey ? translate(labelKey) : name;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-muted">{icon}</div>
            <div>
              <p className="font-medium">{label}</p>
              {detail.message && (
                <p className="text-xs text-muted-foreground mt-0.5 max-w-[200px] truncate">
                  {detail.message}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              {detail.responseTime !== undefined && (
                <span className="text-xs text-muted-foreground block">
                  {detail.responseTime}ms
                </span>
              )}
              {avgResponseTime !== undefined && (
                <span className="text-[10px] text-muted-foreground block">
                  {translate('health.serviceChecks.avgResponse', { value: avgResponseTime })}
                </span>
              )}
            </div>
            {getStatusIcon(detail.status)}
          </div>
        </div>
        <ServiceResponseChart data={historyData} serviceName={name} translate={translate} />
      </CardContent>
    </Card>
  );
}

function HealthSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-32 mb-2" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Separator />
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-24" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-[100px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[120px] w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function HealthSection() {
  const [health, setHealth] = React.useState<HealthCheckResult | null>(null);
  const [history, setHistory] = React.useState<HealthHistoryResponse | null>(null);
  const [stats, setStats] = React.useState<HealthHistoryStats | null>(null);
  const { t } = useModuleTranslation('profile');

  const { execute: fetchHealth, isLoading: isLoadingHealth } = useApiAction(
    profileApi.getHealthStatus,
    {
      showErrorToast: true,
      onSuccess: (data) => setHealth(data),
    }
  );

  const { execute: fetchHistory, isLoading: isLoadingHistory } = useApiAction(
    profileApi.getHealthHistory,
    {
      showErrorToast: false,
      onSuccess: (data) => setHistory(data),
    }
  );

  const { execute: fetchStats, isLoading: isLoadingStats } = useApiAction(
    profileApi.getHealthStats,
    {
      showErrorToast: false,
      onSuccess: (data) => setStats(data),
    }
  );

  const refreshAll = React.useCallback(() => {
    fetchHealth();
    fetchHistory({ minutes: 60, limit: 100 });
    fetchStats(60);
  }, [fetchHealth, fetchHistory, fetchStats]);

  React.useEffect(() => {
    refreshAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const isLoading = isLoadingHealth || isLoadingHistory || isLoadingStats;

  const serviceHistoryData = React.useMemo(() => {
    if (!history?.records?.length) return {};
    const data: Record<string, Array<{ time: string; responseTime: number }>> = {};
    const sortedRecords = [...history.records].reverse();

    for (const record of sortedRecords) {
      const time = formatTime(record.recordedAt);
      for (const [serviceName, check] of Object.entries(record.checks)) {
        if (!data[serviceName]) {
          data[serviceName] = [];
        }
        if (check.responseTime !== undefined) {
          data[serviceName].push({ time, responseTime: check.responseTime });
        }
      }
    }
    return data;
  }, [history]);

  if (isLoadingHealth && !health) {
    return <HealthSkeleton />;
  }

  if (!health) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">{t('health.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('health.description')}
          </p>
        </div>
        <Separator />
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <p>{t('health.loadError')}</p>
            <Button variant="outline" className="mt-4" onClick={refreshAll}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('health.actions.retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t('health.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('health.description')}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          disabled={isLoading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {t('health.actions.refresh')}
        </Button>
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t('health.overall.title')}
          </CardTitle>
          <CardDescription>{t('health.overall.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className={getStatusColor(health.status)}>
                {getStatusLabel(health.status, t)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {t('health.overall.version', { version: health.version })}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>{t('health.overall.uptime', { value: formatUptime(health.uptime) })}</span>
            </div>
          </div>

          <Separator />

          <UptimeChart stats={stats} history={history?.records} translate={t} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('health.serviceChecks.title')}</CardTitle>
          <CardDescription>
            {t('health.serviceChecks.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(health.checks).map(([name, detail]) => (
            <HealthCheckCard
              key={name}
              name={name}
              detail={detail}
              historyData={serviceHistoryData[name] || []}
              avgResponseTime={stats?.avgResponseTimes?.[name]}
              translate={t}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
