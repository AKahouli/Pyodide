/**
 * AnalyticsPage - Platform analytics dashboard with tabs
 */

import { useEffect, useState } from 'react';
import { Users, MessageSquare, Coins, ThumbsUp, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getSummaryAnalytics, getUserAnalytics, getUsageAnalytics, getConversationAnalytics, getQualityAnalytics } from '../api';
import type { SummaryAnalyticsResponse, UserAnalyticsResponse, UsageAnalyticsResponse, ConversationAnalyticsResponse, QualityAnalyticsResponse, AnalyticsQueryParams } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

type AdminTranslate = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;

// Chart colors
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// Format large numbers
function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

// Format percentage
function formatPercent(num: number): string {
  return `${num.toFixed(1)}%`;
}

// Stat card component
function StatCard({ title, value, description, icon: Icon }: { title: string; value: string | number; description?: string; icon: typeof Users }) {
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
        <Icon className='h-4 w-4 text-muted-foreground' />
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-bold'>{value}</div>
        {description && <p className='text-xs text-muted-foreground'>{description}</p>}
      </CardContent>
    </Card>
  );
}

export function AnalyticsPage() {
  const { t, language } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');

  // Analytics data state
  const [summary, setSummary] = useState<SummaryAnalyticsResponse | null>(null);
  const [userAnalytics, setUserAnalytics] = useState<UserAnalyticsResponse | null>(null);
  const [usageAnalytics, setUsageAnalytics] = useState<UsageAnalyticsResponse | null>(null);
  const [conversationAnalytics, setConversationAnalytics] = useState<ConversationAnalyticsResponse | null>(null);
  const [qualityAnalytics, setQualityAnalytics] = useState<QualityAnalyticsResponse | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);

    const params: AnalyticsQueryParams = { groupBy };

    try {
      const [summaryData, userData, usageData, convData, qualityData] = await Promise.all([getSummaryAnalytics(params), getUserAnalytics(params), getUsageAnalytics(params), getConversationAnalytics(params), getQualityAnalytics(params)]);

      setSummary(summaryData);
      setUserAnalytics(userData);
      setUsageAnalytics(usageData);
      setConversationAnalytics(convData);
      setQualityAnalytics(qualityData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('analytics.errors.load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy]);

  if (loading) {
    return (
      <div className='flex items-center justify-center h-96'>
        <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex flex-col items-center justify-center h-96 gap-4'>
        <AlertCircle className='h-12 w-12 text-destructive' />
        <p className='text-muted-foreground'>{error}</p>
        <Button onClick={fetchAnalytics} variant='outline'>
          <RefreshCw className='mr-2 h-4 w-4' />
          {tCommon('actionRetry')}
        </Button>
      </div>
    );
  }

  // Prepare chart data
  const verificationData = userAnalytics
    ? [
        { name: 'Verified', value: userAnalytics.verificationStatus.verified },
        { name: 'Unverified', value: userAnalytics.verificationStatus.unverified },
      ]
    : [];

  const profileData = userAnalytics
    ? [
        { name: 'Complete', value: userAnalytics.profileCompletion.complete },
        { name: 'Incomplete', value: userAnalytics.profileCompletion.incomplete },
      ]
    : [];

  const feedbackData = qualityAnalytics
    ? [
        { name: 'Likes', value: qualityAnalytics.feedbackDistribution.likes },
        { name: 'Dislikes', value: qualityAnalytics.feedbackDistribution.dislikes },
        { name: 'No Feedback', value: qualityAnalytics.feedbackDistribution.none },
      ]
    : [];

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>{t('analytics.title')}</h1>
          <p className='text-muted-foreground'>{t('analytics.description')}</p>
        </div>
        <div className='flex items-center gap-2'>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
            <SelectTrigger className='w-[120px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='day'>{t('analytics.groupBy.day')}</SelectItem>
              <SelectItem value='week'>{t('analytics.groupBy.week')}</SelectItem>
              <SelectItem value='month'>{t('analytics.groupBy.month')}</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={fetchAnalytics} variant='outline' size='icon' aria-label={t('analytics.actions.refresh')}>
            <RefreshCw className='h-4 w-4' />
          </Button>
        </div>
      </div>

      {/* Summary Stats - Always visible */}
      {summary && (
        <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <StatCard title={t('analytics.summary.totalUsers')} value={formatNumber(summary.users.totalConsenting)} description={t('analytics.summary.thisPeriod', { count: summary.users.newThisPeriod })} icon={Users} />
          <StatCard title={t('analytics.summary.conversations')} value={formatNumber(summary.conversations.total)} description={t('analytics.summary.avgMessages', { value: summary.conversations.averageMessages.toFixed(1) })} icon={MessageSquare} />
          <StatCard title={t('analytics.summary.totalTokens')} value={formatNumber(summary.usage.totalTokens)} description={summary.usage.topModel ? t('analytics.summary.topModel', { model: summary.usage.topModel }) : t('analytics.summary.noData')} icon={Coins} />
          <StatCard title={t('analytics.summary.feedbackRate')} value={formatPercent(summary.quality.feedbackRate)} description={t('analytics.summary.positive', { percent: formatPercent(summary.quality.likePercentage) })} icon={ThumbsUp} />
        </div>
      )}

      {/* Tabbed Content */}
      <Tabs defaultValue='users' className='space-y-4'>
        <TabsList>
          <TabsTrigger value='users'>
            <Users className='h-4 w-4 mr-2' />
            {t('analytics.tabs.users')}
          </TabsTrigger>
          <TabsTrigger value='conversations'>
            <MessageSquare className='h-4 w-4 mr-2' />
            {t('analytics.tabs.conversations')}
          </TabsTrigger>
          <TabsTrigger value='quality'>
            <ThumbsUp className='h-4 w-4 mr-2' />
            {t('analytics.tabs.quality')}
          </TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value='users' className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
            {/* New Users Over Time */}
            <Card className='lg:col-span-2'>
              <CardHeader>
                <CardTitle>{t('analytics.users.newUsersOverTime.title')}</CardTitle>
                <CardDescription>{t('analytics.users.newUsersOverTime.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='h-[300px]'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <AreaChart data={userAnalytics?.newUsersOverTime || []}>
                      <CartesianGrid strokeDasharray='3 3' className='stroke-muted' />
                      <XAxis
                        dataKey='date'
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) =>
                          new Date(value).toLocaleDateString(language, {
                            month: 'short',
                            day: 'numeric',
                          })
                        }
                      />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        labelFormatter={(value) => new Date(value).toLocaleDateString(language)}
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                        }}
                      />
                      <Area type='monotone' dataKey='count' stroke='#3b82f6' fill='#3b82f6' fillOpacity={0.2} name={t('analytics.users.newUsersOverTime.title')} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Verification Status */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.users.verificationStatus.title')}</CardTitle>
                <CardDescription>{t('analytics.users.verificationStatus.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='h-[300px]'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <PieChart>
                      <Pie data={verificationData} cx='50%' cy='50%' innerRadius={60} outerRadius={80} paddingAngle={5} dataKey='value' label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {verificationData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Profile Completion */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.users.profileCompletion.title')}</CardTitle>
                <CardDescription>{t('analytics.users.profileCompletion.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='h-[300px]'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <PieChart>
                      <Pie data={profileData} cx='50%' cy='50%' innerRadius={60} outerRadius={80} paddingAngle={5} dataKey='value' label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {profileData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* User Stats */}
            {userAnalytics && (
              <Card className='lg:col-span-2'>
                <CardHeader>
                  <CardTitle>{t('analytics.users.statistics.title')}</CardTitle>
                  <CardDescription>{t('analytics.users.statistics.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='grid gap-4 md:grid-cols-3'>
                    <div className='text-center p-4 rounded-lg bg-muted/50'>
                      <div className='text-3xl font-bold text-primary'>{formatNumber(userAnalytics.totalConsentingUsers)}</div>
                      <div className='text-sm text-muted-foreground'>{t('analytics.users.statistics.totalConsenting')}</div>
                    </div>
                    <div className='text-center p-4 rounded-lg bg-muted/50'>
                      <div className='text-3xl font-bold text-green-500'>{formatPercent((userAnalytics.verificationStatus.verified / userAnalytics.totalConsentingUsers) * 100)}</div>
                      <div className='text-sm text-muted-foreground'>{t('analytics.users.statistics.verifiedRate')}</div>
                    </div>
                    <div className='text-center p-4 rounded-lg bg-muted/50'>
                      <div className='text-3xl font-bold text-blue-500'>{formatPercent((userAnalytics.profileCompletion.complete / userAnalytics.totalConsentingUsers) * 100)}</div>
                      <div className='text-sm text-muted-foreground'>{t('analytics.users.statistics.completionRate')}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Conversations Tab */}
        <TabsContent value='conversations' className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2'>
            {/* Conversations Over Time */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.conversations.overTime.title')}</CardTitle>
                <CardDescription>{t('analytics.conversations.overTime.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='h-[300px]'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <AreaChart data={conversationAnalytics?.conversationsOverTime || []}>
                      <CartesianGrid strokeDasharray='3 3' className='stroke-muted' />
                      <XAxis
                        dataKey='date'
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) =>
                          new Date(value).toLocaleDateString(language, {
                            month: 'short',
                            day: 'numeric',
                          })
                        }
                      />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        labelFormatter={(value) => new Date(value).toLocaleDateString(language)}
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                        }}
                      />
                      <Area type='monotone' dataKey='count' stroke='#8b5cf6' fill='#8b5cf6' fillOpacity={0.2} name={t('analytics.tabs.conversations')} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Usage Over Time */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.conversations.tokenUsage.title')}</CardTitle>
                <CardDescription>{t('analytics.conversations.tokenUsage.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='h-[300px]'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <AreaChart data={usageAnalytics?.usageOverTime || []}>
                      <CartesianGrid strokeDasharray='3 3' className='stroke-muted' />
                      <XAxis
                        dataKey='date'
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) =>
                          new Date(value).toLocaleDateString(language, {
                            month: 'short',
                            day: 'numeric',
                          })
                        }
                      />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={formatNumber} />
                      <Tooltip
                        labelFormatter={(value) => new Date(value).toLocaleDateString(language)}
                        formatter={(value: number) => formatNumber(value)}
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                        }}
                      />
                      <Area type='monotone' dataKey='count' stroke='#10b981' fill='#10b981' fillOpacity={0.2} name='Tokens' />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Tokens by Model */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.conversations.tokensByModel.title')}</CardTitle>
                <CardDescription>{t('analytics.conversations.tokensByModel.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='h-[300px]'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart data={usageAnalytics?.tokensByModel || []} layout='vertical'>
                      <CartesianGrid strokeDasharray='3 3' className='stroke-muted' />
                      <XAxis type='number' tick={{ fontSize: 12 }} tickFormatter={formatNumber} />
                      <YAxis dataKey='model' type='category' tick={{ fontSize: 12 }} width={100} />
                      <Tooltip
                        formatter={(value: number) => formatNumber(value)}
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                        }}
                      />
                      <Legend />
                      <Bar dataKey='inputTokens' fill='#3b82f6' name='Input Tokens' />
                      <Bar dataKey='outputTokens' fill='#10b981' name='Output Tokens' />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Component Type Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.conversations.messageComponents.title')}</CardTitle>
                <CardDescription>{t('analytics.conversations.messageComponents.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='h-[300px]'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <PieChart>
                      <Pie data={conversationAnalytics?.componentTypeDistribution || []} cx='50%' cy='50%' innerRadius={60} outerRadius={80} paddingAngle={5} dataKey='count' nameKey='type' label={({ type, percentage }) => `${type} ${percentage.toFixed(0)}%`}>
                        {(conversationAnalytics?.componentTypeDistribution || []).map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Conversation Stats */}
          {conversationAnalytics && usageAnalytics && (
            <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-medium'>{t('analytics.conversations.stats.totalConversations')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold'>{formatNumber(conversationAnalytics.totalConversations)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-medium'>{t('analytics.conversations.stats.avgMessages')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold'>{conversationAnalytics.messagesPerConversation.average.toFixed(1)}</div>
                  <p className='text-xs text-muted-foreground'>
                    {t('analytics.conversations.stats.minMax', { min: conversationAnalytics.messagesPerConversation.min, max: conversationAnalytics.messagesPerConversation.max })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-medium'>{t('analytics.conversations.stats.avgDuration')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold'>{t('analytics.conversations.stats.minutes', { count: Math.round(conversationAnalytics.averageConversationDurationMs / 60000) })}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-medium'>{t('analytics.conversations.stats.avgTokens')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold'>{formatNumber(usageAnalytics.averageTokensPerConversation)}</div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Quality Tab */}
        <TabsContent value='quality' className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
            {/* Feedback Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.quality.feedbackDistribution.title')}</CardTitle>
                <CardDescription>{t('analytics.quality.feedbackDistribution.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='h-[300px]'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <PieChart>
                      <Pie data={feedbackData} cx='50%' cy='50%' innerRadius={60} outerRadius={80} paddingAngle={5} dataKey='value' label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        <Cell fill='#10b981' />
                        <Cell fill='#ef4444' />
                        <Cell fill='#6b7280' />
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Reports by Category */}
            <Card className='lg:col-span-2'>
              <CardHeader>
                <CardTitle>{t('analytics.quality.reportsByCategory.title')}</CardTitle>
                <CardDescription>{t('analytics.quality.reportsByCategory.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='h-[300px]'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart data={qualityAnalytics?.reportsByCategory || []}>
                      <CartesianGrid strokeDasharray='3 3' className='stroke-muted' />
                      <XAxis dataKey='category' tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                        }}
                      />
                      <Bar dataKey='count' fill='#ef4444' name='Reports' />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Error Rates */}
            {usageAnalytics && usageAnalytics.errorRates.length > 0 && (
              <Card className='lg:col-span-3'>
                <CardHeader>
                  <CardTitle>{t('analytics.quality.errorRates.title')}</CardTitle>
                  <CardDescription>{t('analytics.quality.errorRates.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='h-[250px]'>
                    <ResponsiveContainer width='100%' height='100%'>
                      <BarChart data={usageAnalytics.errorRates}>
                        <CartesianGrid strokeDasharray='3 3' className='stroke-muted' />
                        <XAxis dataKey='model' tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `${value}%`} />
                        <Tooltip
                          formatter={(value: number) => `${value.toFixed(2)}%`}
                          contentStyle={{
                            backgroundColor: 'var(--card)',
                            border: '1px solid var(--border)',
                          }}
                        />
                        <Bar dataKey='errorRate' fill='#f59e0b' name='Error Rate' />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Quality Stats */}
          {qualityAnalytics && (
            <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-medium'>{t('analytics.quality.stats.feedbackRate')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold'>{formatPercent(qualityAnalytics.feedbackRate)}</div>
                  <p className='text-xs text-muted-foreground'>{t('analytics.quality.stats.ofMessages')}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-medium'>{t('analytics.quality.stats.positiveFeedback')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold text-green-500'>{formatPercent((qualityAnalytics.feedbackDistribution.likes / (qualityAnalytics.feedbackDistribution.likes + qualityAnalytics.feedbackDistribution.dislikes || 1)) * 100)}</div>
                  <p className='text-xs text-muted-foreground'>{t('analytics.quality.stats.likes', { count: qualityAnalytics.feedbackDistribution.likes })}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-medium'>{t('analytics.quality.stats.totalReports')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold text-red-500'>{qualityAnalytics.totalReports}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-medium'>{t('analytics.quality.stats.regenerationRate')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold'>{formatPercent(qualityAnalytics.regenerationRate)}</div>
                  <p className='text-xs text-muted-foreground'>{t('analytics.quality.stats.regenerated')}</p>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
