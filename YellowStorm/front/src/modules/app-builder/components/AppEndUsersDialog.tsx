import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  User,
  Users,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  appBuilderApi,
  type AppEndUserGrants,
  type AppEndUserSummary,
} from '../api';

interface AppEndUsersDialogProps {
  sessionId: string;
  appTitle?: string;
  /** When true, show the per-user AI usage permission toggle. */
  hasAiFeatures?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CrudGrantKey = 'create' | 'read' | 'update' | 'delete';
type GrantKey = keyof AppEndUserGrants;

const CRUD_GRANT_KEYS: CrudGrantKey[] = ['create', 'read', 'update', 'delete'];

const CRUD_PRESETS: Record<'none' | 'readOnly' | 'full', Pick<AppEndUserGrants, CrudGrantKey>> = {
  none: { create: false, read: false, update: false, delete: false },
  readOnly: { create: false, read: true, update: false, delete: false },
  full: { create: true, read: true, update: true, delete: true },
};

function normalizeGrants(grants: Partial<AppEndUserGrants> | undefined): AppEndUserGrants {
  return {
    create: grants?.create === true,
    read: grants?.read === true,
    update: grants?.update === true,
    delete: grants?.delete === true,
    useAi: grants?.useAi === true,
  };
}

function visibleGrantKeys(showAiGrant: boolean): GrantKey[] {
  return showAiGrant ? [...CRUD_GRANT_KEYS, 'useAi'] : [...CRUD_GRANT_KEYS];
}

function countEnabledGrants(grants: AppEndUserGrants, keys: GrantKey[]): number {
  return keys.filter((key) => grants[key]).length;
}

function userInitials(user: AppEndUserSummary): string {
  const source = (user.displayName || user.email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function matchesSearch(user: AppEndUserSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    user.email.toLowerCase().includes(q) ||
    (user.displayName?.toLowerCase().includes(q) ?? false)
  );
}

export function AppEndUsersDialog({
  sessionId,
  appTitle,
  hasAiFeatures = false,
  open,
  onOpenChange,
}: AppEndUsersDialogProps) {
  const { t } = useModuleTranslation('app-builder');
  const [users, setUsers] = useState<AppEndUserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const showAiGrant = useMemo(
    () => hasAiFeatures || users.some((user) => user.grants.useAi === true),
    [hasAiFeatures, users],
  );
  const grantKeys = useMemo(() => visibleGrantKeys(showAiGrant), [showAiGrant]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await appBuilderApi.listEndUsers(sessionId);
      setUsers(
        list.map((user) => ({
          ...user,
          grants: normalizeGrants(user.grants),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('endUsers.loadError'));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, t]);

  useEffect(() => {
    if (open) {
      setSearch('');
      void loadUsers();
    }
  }, [open, loadUsers]);

  const filteredUsers = useMemo(
    () => users.filter((user) => matchesSearch(user, search)),
    [users, search],
  );

  const updateUser = (updated: AppEndUserSummary) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === updated.id
          ? { ...updated, grants: normalizeGrants(updated.grants) }
          : u,
      ),
    );
  };

  const updateGrants = async (userId: string, grants: AppEndUserGrants) => {
    setSavingUserId(userId);
    setError(null);
    try {
      const updated = await appBuilderApi.updateEndUserGrants(
        sessionId,
        userId,
        normalizeGrants(grants),
      );
      updateUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('endUsers.saveError'));
    } finally {
      setSavingUserId(null);
    }
  };

  const updateGrant = async (userId: string, key: GrantKey, value: boolean) => {
    const user = users.find((u) => u.id === userId);
    if (!user || user.status === 'disabled') return;
    await updateGrants(userId, { ...normalizeGrants(user.grants), [key]: value });
  };

  const applyPreset = async (userId: string, preset: keyof typeof CRUD_PRESETS) => {
    const user = users.find((u) => u.id === userId);
    if (!user || user.status === 'disabled') return;
    await updateGrants(userId, {
      ...CRUD_PRESETS[preset],
      useAi: user.grants.useAi === true,
    });
  };

  const userCountLabel =
    users.length === 1
      ? t('endUsers.userCountOne')
      : t('endUsers.userCount', { count: users.length });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0'>
        <DialogHeader className='space-y-3 border-b px-6 py-5'>
          <div className='flex items-start gap-3'>
            <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10'>
              <Users className='h-5 w-5 text-primary' />
            </div>
            <div className='min-w-0 flex-1 space-y-1'>
              <DialogTitle className='text-left'>{t('endUsers.title')}</DialogTitle>
              <DialogDescription className='text-left'>
                {appTitle
                  ? t('endUsers.descriptionNamed', { title: appTitle })
                  : t('endUsers.description')}
              </DialogDescription>
            </div>
            {!loading && users.length > 0 && (
              <Badge variant='secondary' className='shrink-0'>
                {userCountLabel}
              </Badge>
            )}
          </div>

          <Alert className='border-border/60 bg-muted/30'>
            <Shield className='h-4 w-4' />
            <AlertDescription>{t('endUsers.hint')}</AlertDescription>
          </Alert>

          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <div className='relative flex-1'>
              <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('endUsers.searchPlaceholder')}
                className='pl-9'
                disabled={loading}
              />
            </div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='shrink-0'
              disabled={loading}
              onClick={() => void loadUsers()}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              {t('endUsers.refresh')}
            </Button>
          </div>
        </DialogHeader>

        <div className='flex-1 overflow-y-auto px-6 py-4'>
          {loading && (
            <div className='space-y-3'>
              {[0, 1, 2].map((i) => (
                <div key={i} className='flex items-center gap-4 rounded-lg border p-4'>
                  <Skeleton className='h-10 w-10 rounded-full' />
                  <div className='flex-1 space-y-2'>
                    <Skeleton className='h-4 w-40' />
                    <Skeleton className='h-3 w-56' />
                  </div>
                  <Skeleton className='h-8 w-24' />
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertDescription className='flex flex-wrap items-center justify-between gap-2'>
                <span>{error}</span>
                <Button type='button' size='sm' variant='outline' onClick={() => void loadUsers()}>
                  {t('endUsers.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!loading && !error && users.length === 0 && (
            <div className='flex flex-col items-center justify-center gap-3 py-16 text-center'>
              <div className='flex h-14 w-14 items-center justify-center rounded-full bg-muted'>
                <User className='h-7 w-7 text-muted-foreground' />
              </div>
              <div className='space-y-1'>
                <p className='font-medium'>{t('endUsers.emptyTitle')}</p>
                <p className='max-w-sm text-sm text-muted-foreground'>{t('endUsers.empty')}</p>
              </div>
            </div>
          )}

          {!loading && !error && users.length > 0 && filteredUsers.length === 0 && (
            <p className='py-12 text-center text-sm text-muted-foreground'>
              {t('endUsers.noResults')}
            </p>
          )}

          {!loading && !error && filteredUsers.length > 0 && (
            <>
              <div className='hidden md:block'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('endUsers.userColumn')}</TableHead>
                      {grantKeys.map((key) => (
                        <TableHead key={key} className='text-center'>
                          {t(`endUsers.grants.${key}`)}
                        </TableHead>
                      ))}
                      <TableHead className='w-[140px]'>{t('endUsers.actionsColumn')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <EndUserTableRow
                        key={user.id}
                        user={user}
                        grantKeys={grantKeys}
                        saving={savingUserId === user.id}
                        onToggleGrant={(key, value) => void updateGrant(user.id, key, value)}
                        onApplyPreset={(preset) => void applyPreset(user.id, preset)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className='space-y-4 md:hidden'>
                {filteredUsers.map((user) => (
                  <EndUserMobileCard
                    key={user.id}
                    user={user}
                    grantKeys={grantKeys}
                    saving={savingUserId === user.id}
                    onToggleGrant={(key, value) => void updateGrant(user.id, key, value)}
                    onApplyPreset={(preset) => void applyPreset(user.id, preset)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface EndUserRowProps {
  user: AppEndUserSummary;
  grantKeys: GrantKey[];
  saving: boolean;
  onToggleGrant: (key: GrantKey, value: boolean) => void;
  onApplyPreset: (preset: keyof typeof CRUD_PRESETS) => void;
}

function EndUserTableRow({
  user,
  grantKeys,
  saving,
  onToggleGrant,
  onApplyPreset,
}: EndUserRowProps) {
  const { t } = useModuleTranslation('app-builder');
  const disabled = user.status === 'disabled';
  const enabledCount = countEnabledGrants(user.grants, grantKeys);

  return (
    <TableRow className={cn(disabled && 'opacity-60')}>
      <TableCell>
        <div className='flex items-center gap-3'>
          <Avatar className='h-9 w-9'>
            <AvatarFallback className='text-xs'>{userInitials(user)}</AvatarFallback>
          </Avatar>
          <div className='min-w-0'>
            <p className='truncate font-medium'>{user.displayName || user.email}</p>
            {user.displayName && (
              <p className='truncate text-xs text-muted-foreground'>{user.email}</p>
            )}
            <p className='text-xs text-muted-foreground'>
              {t('endUsers.registeredAt', {
                date: new Date(user.createdAt).toLocaleDateString(),
              })}
            </p>
          </div>
        </div>
      </TableCell>
      {grantKeys.map((key) => (
        <TableCell key={key} className='text-center'>
          <Switch
            checked={user.grants[key]}
            disabled={saving || disabled}
            onCheckedChange={(checked) => onToggleGrant(key, checked)}
            aria-label={t(`endUsers.grants.${key}`)}
          />
        </TableCell>
      ))}
      <TableCell>
        <div className='flex items-center gap-2'>
          {saving && <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />}
          <PresetMenu
            disabled={saving || disabled}
            summary={t('endUsers.grantsSummary', {
              enabled: enabledCount,
              total: grantKeys.length,
            })}
            onApplyPreset={onApplyPreset}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function EndUserMobileCard({
  user,
  grantKeys,
  saving,
  onToggleGrant,
  onApplyPreset,
}: EndUserRowProps) {
  const { t } = useModuleTranslation('app-builder');
  const disabled = user.status === 'disabled';
  const enabledCount = countEnabledGrants(user.grants, grantKeys);

  return (
    <div className={cn('rounded-xl border p-4', disabled && 'opacity-60')}>
      <div className='flex items-start gap-3'>
        <Avatar className='h-10 w-10'>
          <AvatarFallback>{userInitials(user)}</AvatarFallback>
        </Avatar>
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>{user.displayName || user.email}</p>
          {user.displayName && (
            <p className='truncate text-sm text-muted-foreground'>{user.email}</p>
          )}
          <p className='mt-1 text-xs text-muted-foreground'>
            {t('endUsers.registeredAt', { date: new Date(user.createdAt).toLocaleDateString() })}
            {' · '}
            {t('endUsers.grantsSummary', {
              enabled: enabledCount,
              total: grantKeys.length,
            })}
          </p>
        </div>
        {saving && <Loader2 className='h-4 w-4 shrink-0 animate-spin text-muted-foreground' />}
      </div>

      <Separator className='my-4' />

      <div className='mb-3 flex items-center justify-between'>
        <span className='text-sm font-medium'>{t('endUsers.grantsColumn')}</span>
        <PresetMenu disabled={saving || disabled} onApplyPreset={onApplyPreset} />
      </div>

      <div className='grid grid-cols-2 gap-2'>
        {grantKeys.map((key) => (
          <div
            key={key}
            className='flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2'
          >
            <Label htmlFor={`${user.id}-${key}`} className='text-sm'>
              {t(`endUsers.grants.${key}`)}
            </Label>
            <Switch
              id={`${user.id}-${key}`}
              checked={user.grants[key]}
              disabled={saving || disabled}
              onCheckedChange={(checked) => onToggleGrant(key, checked)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PresetMenu({
  disabled,
  summary,
  onApplyPreset,
}: {
  disabled: boolean;
  summary?: string;
  onApplyPreset: (preset: keyof typeof CRUD_PRESETS) => void;
}) {
  const { t } = useModuleTranslation('app-builder');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type='button' variant='outline' size='sm' disabled={disabled}>
          {summary ?? t('endUsers.presets.label')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onClick={() => onApplyPreset('none')}>
          {t('endUsers.presets.none')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onApplyPreset('readOnly')}>
          {t('endUsers.presets.readOnly')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onApplyPreset('full')}>
          {t('endUsers.presets.full')}
        </DropdownMenuItem>
        <p className='max-w-[14rem] px-2 py-1.5 text-[10px] leading-snug text-muted-foreground'>
          {t('endUsers.presets.hint')}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
