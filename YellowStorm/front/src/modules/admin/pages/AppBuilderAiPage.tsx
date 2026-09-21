import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Coins,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import {
  assignAppBuilderAiOffer,
  createAppBuilderAiOffer,
  deleteAppBuilderAiOffer,
  getAppBuilderAiOverview,
  getAppBuilderAiUserDetail,
  listAppBuilderAiOffers,
  listAppBuilderAiUsers,
  setAppBuilderAiEnabled,
  updateAppBuilderAiOffer,
  type AppBuilderAiOffer,
  type AppBuilderAiOverview,
  type AppBuilderAiUserRow,
} from '../api';

function formatTokens(n: number): string {
  if (n < 0) return '∞';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function AppBuilderAiPage() {
  const { t } = useModuleTranslation('admin');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<AppBuilderAiOverview | null>(null);
  const [users, setUsers] = useState<AppBuilderAiUserRow[]>([]);
  const [offers, setOffers] = useState<AppBuilderAiOffer[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offerFilter, setOfferFilter] = useState<string>('all');
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [assignUserId, setAssignUserId] = useState<string | null>(null);
  const [assignOfferId, setAssignOfferId] = useState('');
  const [offerDialog, setOfferDialog] = useState<'create' | AppBuilderAiOffer | null>(null);
  const [offerForm, setOfferForm] = useState({
    name: '',
    slug: '',
    tokenLimit: 50000,
    windowHours: 24,
    description: '',
  });
  const [toggling, setToggling] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, userList, offerList] = await Promise.all([
        getAppBuilderAiOverview(),
        listAppBuilderAiUsers({
          q: debouncedSearch || undefined,
          offerId: offerFilter === 'all' ? undefined : offerFilter,
          limit: 50,
        }),
        listAppBuilderAiOffers(),
      ]);
      setOverview(ov);
      setUsers(userList.items);
      setOffers(offerList.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('appBuilderAi.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, offerFilter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (userId: string) => {
    setDetailUserId(userId);
    setDetail(null);
    try {
      setDetail(await getAppBuilderAiUserDetail(userId));
    } catch (err) {
      setDetail(null);
      showError(t('appBuilderAi.errors.detail'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const onToggleEnabled = async (enabled: boolean) => {
    if (!enabled && !window.confirm(t('appBuilderAi.killSwitch.confirmDisable'))) return;
    setToggling(true);
    try {
      const next = await setAppBuilderAiEnabled(enabled);
      setOverview((prev) => (prev ? { ...prev, enabled: next.enabled } : prev));
      showSuccess(
        enabled ? t('appBuilderAi.toasts.enabled') : t('appBuilderAi.toasts.disabled'),
      );
    } catch (err) {
      showError(t('appBuilderAi.errors.save'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setToggling(false);
    }
  };

  const saveOffer = async () => {
    setSaving(true);
    try {
      if (offerDialog === 'create') {
        await createAppBuilderAiOffer(offerForm);
      } else if (offerDialog) {
        await updateAppBuilderAiOffer(offerDialog.id, offerForm);
      }
      setOfferDialog(null);
      showSuccess(t('appBuilderAi.toasts.offerSaved'));
      await load();
    } catch (err) {
      showError(t('appBuilderAi.errors.save'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading && !overview) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className='flex flex-col items-center gap-3 py-16 text-muted-foreground'>
        <AlertCircle className='h-8 w-8' />
        <p>{error}</p>
        <Button variant='outline' onClick={() => void load()}>
          <RefreshCw className='mr-2 h-4 w-4' />
          {t('appBuilderAi.actions.refresh')}
        </Button>
      </div>
    );
  }

  const detailApps = (detail?.apps as Array<Record<string, unknown>> | undefined) ?? [];
  const detailModels = (detail?.byModel as Array<Record<string, unknown>> | undefined) ?? [];
  const detailUser = detail?.user as { email?: string; displayName?: string | null } | undefined;
  const detailUsage = detail?.usage as {
    currentUsage?: number;
    limit?: number;
    resetsAt?: string;
  } | undefined;
  const detailUnattributed = detail?.unattributed as {
    totalTokens?: number;
    requestCount?: number;
  } | undefined;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>{t('appBuilderAi.title')}</h1>
          <p className='mt-1 max-w-2xl text-sm text-muted-foreground'>
            {t('appBuilderAi.description')}
          </p>
        </div>
        <div className='flex items-center gap-3 rounded-lg border px-4 py-3'>
          <Sparkles className='h-4 w-4 text-violet-600' />
          <div className='mr-2'>
            <p className='text-sm font-medium'>{t('appBuilderAi.killSwitch.label')}</p>
            <p className='text-xs text-muted-foreground'>{t('appBuilderAi.killSwitch.hint')}</p>
          </div>
          <Switch
            checked={overview?.enabled ?? true}
            disabled={toggling}
            onCheckedChange={(v) => void onToggleEnabled(v)}
          />
        </div>
      </div>

      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium'>{t('appBuilderAi.stats.tokens')}</CardTitle>
          </CardHeader>
          <CardContent className='flex items-center justify-between'>
            <div className='text-2xl font-bold'>{formatTokens(overview?.totalTokens ?? 0)}</div>
            <Coins className='h-4 w-4 text-muted-foreground' />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium'>{t('appBuilderAi.stats.apps')}</CardTitle>
          </CardHeader>
          <CardContent className='flex items-center justify-between'>
            <div className='text-2xl font-bold'>{overview?.aiAppsCount ?? 0}</div>
            <Bot className='h-4 w-4 text-muted-foreground' />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium'>{t('appBuilderAi.stats.users')}</CardTitle>
          </CardHeader>
          <CardContent className='flex items-center justify-between'>
            <div className='text-2xl font-bold'>{overview?.usersWithOffer ?? 0}</div>
            <Users className='h-4 w-4 text-muted-foreground' />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium'>{t('appBuilderAi.stats.requests')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>{overview?.requestCount ?? 0}</div>
            <p className='text-xs text-muted-foreground'>
              {t('appBuilderAi.stats.errors', { count: overview?.errorCount ?? 0 })}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue='users'>
        <TabsList>
          <TabsTrigger value='users'>{t('appBuilderAi.tabs.users')}</TabsTrigger>
          <TabsTrigger value='offers'>{t('appBuilderAi.tabs.offers')}</TabsTrigger>
          <TabsTrigger value='models'>{t('appBuilderAi.tabs.models')}</TabsTrigger>
        </TabsList>

        <TabsContent value='users' className='space-y-4'>
          <div className='flex flex-wrap gap-2'>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('appBuilderAi.filters.search')}
              className='max-w-xs'
            />
            <Select value={offerFilter} onValueChange={setOfferFilter}>
              <SelectTrigger className='w-[200px]'>
                <SelectValue placeholder={t('appBuilderAi.filters.offer')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>{t('appBuilderAi.filters.allOffers')}</SelectItem>
                {offers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant='outline' size='sm' onClick={() => void load()}>
              <RefreshCw className='mr-2 h-3.5 w-3.5' />
              {t('appBuilderAi.actions.refresh')}
            </Button>
          </div>

          <Card>
            <CardContent className='p-0'>
              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <thead className='border-b bg-muted/40 text-left text-muted-foreground'>
                    <tr>
                      <th className='px-4 py-3 font-medium'>{t('appBuilderAi.table.user')}</th>
                      <th className='px-4 py-3 font-medium'>{t('appBuilderAi.table.offer')}</th>
                      <th className='px-4 py-3 font-medium'>{t('appBuilderAi.table.apps')}</th>
                      <th className='px-4 py-3 font-medium'>{t('appBuilderAi.table.usage')}</th>
                      <th className='px-4 py-3 font-medium'>{t('appBuilderAi.table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((row) => (
                      <tr key={row.userId} className='border-b last:border-0'>
                        <td className='px-4 py-3'>
                          <div className='font-medium'>{row.displayName || row.email}</div>
                          {row.displayName ? (
                            <div className='text-xs text-muted-foreground'>{row.email}</div>
                          ) : null}
                        </td>
                        <td className='px-4 py-3'>
                          {row.offer ? (
                            <Badge variant='outline'>{row.offer.name}</Badge>
                          ) : (
                            <span className='text-muted-foreground'>—</span>
                          )}
                        </td>
                        <td className='px-4 py-3'>{row.aiAppsCount}</td>
                        <td className='px-4 py-3'>
                          {row.usage
                            ? `${formatTokens(row.usage.currentUsage)} / ${formatTokens(row.usage.limit)} (${row.usage.percentUsed}%)`
                            : '—'}
                        </td>
                        <td className='px-4 py-3'>
                          <div className='flex gap-2'>
                            <Button size='sm' variant='ghost' onClick={() => void openDetail(row.userId)}>
                              {t('appBuilderAi.actions.view')}
                            </Button>
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={() => {
                                setAssignUserId(row.userId);
                                setAssignOfferId(row.offer?.id ?? offers[0]?.id ?? '');
                              }}
                            >
                              {t('appBuilderAi.actions.assignOffer')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={5} className='px-4 py-8 text-center text-muted-foreground'>
                          {t('appBuilderAi.empty.users')}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='offers' className='space-y-4'>
          <div className='flex justify-end'>
            <Button
              onClick={() => {
                setOfferForm({ name: '', slug: '', tokenLimit: 50000, windowHours: 24, description: '' });
                setOfferDialog('create');
              }}
            >
              {t('appBuilderAi.actions.createOffer')}
            </Button>
          </div>
          <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
            {offers.map((offer) => (
              <Card key={offer.id}>
                <CardHeader>
                  <div className='flex items-start justify-between gap-2'>
                    <div>
                      <CardTitle className='text-base'>{offer.name}</CardTitle>
                      <CardDescription>{offer.slug}</CardDescription>
                    </div>
                    <div className='flex gap-1'>
                      {offer.isDefault ? <Badge>{t('appBuilderAi.offer.default')}</Badge> : null}
                      {!offer.isActive ? (
                        <Badge variant='secondary'>{t('appBuilderAi.offer.inactive')}</Badge>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='space-y-2 text-sm'>
                  <p>
                    {t('appBuilderAi.offer.tokens')}: {formatTokens(offer.tokenLimit)} /{' '}
                    {offer.windowHours}h
                  </p>
                  <p className='text-muted-foreground'>{offer.description}</p>
                  <div className='flex gap-2 pt-2'>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => {
                        setOfferForm({
                          name: offer.name,
                          slug: offer.slug,
                          tokenLimit: offer.tokenLimit,
                          windowHours: offer.windowHours,
                          description: offer.description ?? '',
                        });
                        setOfferDialog(offer);
                      }}
                    >
                      {t('appBuilderAi.actions.edit')}
                    </Button>
                    {!offer.isDefault ? (
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={saving}
                        onClick={() => {
                          if (!window.confirm(t('appBuilderAi.offer.confirmDelete'))) return;
                          setSaving(true);
                          void deleteAppBuilderAiOffer(offer.id)
                            .then(async () => {
                              showSuccess(t('appBuilderAi.toasts.offerDeleted'));
                              await load();
                            })
                            .catch((err) => {
                              showError(t('appBuilderAi.errors.save'), {
                                description: err instanceof Error ? err.message : undefined,
                              });
                            })
                            .finally(() => setSaving(false));
                        }}
                      >
                        {t('appBuilderAi.actions.delete')}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value='models'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>{t('appBuilderAi.models.title')}</CardTitle>
              <CardDescription>{t('appBuilderAi.models.description')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              {(overview?.topModels ?? []).map((m) => (
                <div
                  key={m.model}
                  className='flex items-center justify-between rounded-md border px-3 py-2 text-sm'
                >
                  <span className='font-medium'>{m.model}</span>
                  <span className='text-muted-foreground'>
                    {formatTokens(m.totalTokens)} · {m.requestCount}{' '}
                    {t('appBuilderAi.models.requests')}
                  </span>
                </div>
              ))}
              {(overview?.topModels?.length ?? 0) === 0 ? (
                <p className='text-sm text-muted-foreground'>{t('appBuilderAi.empty.models')}</p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Sheet open={!!detailUserId} onOpenChange={(open) => !open && setDetailUserId(null)}>
        <SheetContent className='w-full overflow-y-auto sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>{detailUser?.displayName || detailUser?.email || '…'}</SheetTitle>
            <SheetDescription>{t('appBuilderAi.detail.description')}</SheetDescription>
          </SheetHeader>
          {detail ? (
            <div className='mt-6 space-y-6'>
              <div className='rounded-lg border p-3 text-sm'>
                <p>
                  {t('appBuilderAi.detail.usage')}:{' '}
                  {formatTokens(detailUsage?.currentUsage ?? 0)} /{' '}
                  {formatTokens(detailUsage?.limit ?? 0)}
                </p>
                {detailUsage?.resetsAt ? (
                  <p className='text-muted-foreground'>
                    {t('appBuilderAi.detail.resetsAt', {
                      date: new Date(detailUsage.resetsAt).toLocaleString(),
                    })}
                  </p>
                ) : null}
              </div>
              <div>
                <h3 className='mb-2 text-sm font-semibold'>{t('appBuilderAi.detail.apps')}</h3>
                <div className='space-y-2'>
                  {detailApps.map((app) => (
                    <div key={String(app.sessionId)} className='rounded-md border p-3 text-sm'>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='font-medium'>{String(app.title)}</span>
                        <Badge variant='outline' className='gap-0.5'>
                          <Sparkles className='h-3 w-3' />
                          {t('appBuilderAi.badge.ai')}
                        </Badge>
                      </div>
                      <p className='mt-1 text-muted-foreground'>
                        {formatTokens(Number(app.totalTokens ?? 0))} ·{' '}
                        {Number(app.requestCount ?? 0)} {t('appBuilderAi.models.requests')}
                      </p>
                      <div className='mt-2 flex flex-wrap gap-1'>
                        {((app.models as Array<{ model: string; totalTokens: number }>) ?? []).map(
                          (m) => (
                            <Badge key={m.model} variant='secondary' className='text-[10px]'>
                              {m.model}: {formatTokens(m.totalTokens)}
                            </Badge>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                  {detailApps.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>{t('appBuilderAi.empty.apps')}</p>
                  ) : null}
                  {detailUnattributed
                    && (Number(detailUnattributed.totalTokens ?? 0) > 0
                      || Number(detailUnattributed.requestCount ?? 0) > 0) ? (
                    <div className='rounded-md border border-dashed p-3 text-sm'>
                      <p className='font-medium'>{t('appBuilderAi.detail.unattributed')}</p>
                      <p className='mt-1 text-muted-foreground'>
                        {formatTokens(Number(detailUnattributed.totalTokens ?? 0))} ·{' '}
                        {Number(detailUnattributed.requestCount ?? 0)}{' '}
                        {t('appBuilderAi.models.requests')}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
              <div>
                <h3 className='mb-2 text-sm font-semibold'>{t('appBuilderAi.detail.models')}</h3>
                <div className='space-y-1'>
                  {detailModels.map((m) => (
                    <div key={String(m.model)} className='flex justify-between text-sm'>
                      <span>{String(m.model)}</span>
                      <span className='text-muted-foreground'>
                        {formatTokens(Number(m.totalTokens ?? 0))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className='flex justify-center py-12'>
              <Loader2 className='h-5 w-5 animate-spin' />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!assignUserId} onOpenChange={(open) => !open && setAssignUserId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('appBuilderAi.actions.assignOffer')}</DialogTitle>
          </DialogHeader>
          <Select value={assignOfferId} onValueChange={setAssignOfferId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {offers.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button
              disabled={saving || !assignUserId || !assignOfferId}
              onClick={() => {
                if (!assignUserId || !assignOfferId) return;
                setSaving(true);
                void assignAppBuilderAiOffer(assignUserId, assignOfferId)
                  .then(async () => {
                    setAssignUserId(null);
                    showSuccess(t('appBuilderAi.toasts.offerAssigned'));
                    await load();
                  })
                  .catch((err) => {
                    showError(t('appBuilderAi.errors.save'), {
                      description: err instanceof Error ? err.message : undefined,
                    });
                  })
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
              {t('appBuilderAi.actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!offerDialog} onOpenChange={(open) => !open && setOfferDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {offerDialog === 'create'
                ? t('appBuilderAi.actions.createOffer')
                : t('appBuilderAi.actions.edit')}
            </DialogTitle>
          </DialogHeader>
          <div className='space-y-3'>
            <div>
              <Label>{t('appBuilderAi.offer.name')}</Label>
              <Input
                value={offerForm.name}
                onChange={(e) => setOfferForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t('appBuilderAi.offer.slug')}</Label>
              <Input
                value={offerForm.slug}
                onChange={(e) => setOfferForm((f) => ({ ...f, slug: e.target.value }))}
                disabled={offerDialog !== 'create'}
              />
            </div>
            <div>
              <Label>{t('appBuilderAi.offer.tokens')}</Label>
              <Input
                type='number'
                value={offerForm.tokenLimit}
                onChange={(e) =>
                  setOfferForm((f) => ({ ...f, tokenLimit: Number(e.target.value) }))
                }
              />
            </div>
            <div>
              <Label>{t('appBuilderAi.offer.windowHours')}</Label>
              <Input
                type='number'
                value={offerForm.windowHours}
                onChange={(e) =>
                  setOfferForm((f) => ({ ...f, windowHours: Number(e.target.value) }))
                }
              />
            </div>
            <div>
              <Label>{t('appBuilderAi.offer.description')}</Label>
              <Input
                value={offerForm.description}
                onChange={(e) => setOfferForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={saving} onClick={() => void saveOffer()}>
              {saving ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
              {t('appBuilderAi.actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
