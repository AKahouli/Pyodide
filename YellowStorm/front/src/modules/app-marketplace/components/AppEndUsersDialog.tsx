import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useModuleTranslation } from '@/modules/localization';
import {
  appMarketplaceApi,
  type AppEndUserGrants,
  type AppEndUserSummary,
} from '../api';

interface AppEndUsersDialogProps {
  sessionId: string;
  appTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GrantKey = keyof AppEndUserGrants;

const GRANT_KEYS: GrantKey[] = ['create', 'read', 'update', 'delete'];

export function AppEndUsersDialog({
  sessionId,
  appTitle,
  open,
  onOpenChange,
}: AppEndUsersDialogProps) {
  const { t } = useModuleTranslation('app-marketplace');
  const [users, setUsers] = useState<AppEndUserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await appMarketplaceApi.listEndUsers(sessionId);
      setUsers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('endUsers.loadError'));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, t]);

  useEffect(() => {
    if (open) void loadUsers();
  }, [open, loadUsers]);

  const updateGrant = async (userId: string, key: GrantKey, value: boolean) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    const nextGrants: AppEndUserGrants = { ...user.grants, [key]: value };
    setSavingUserId(userId);
    setError(null);
    try {
      const updated = await appMarketplaceApi.updateEndUserGrants(sessionId, userId, nextGrants);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('endUsers.saveError'));
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] max-w-3xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{t('endUsers.title')}</DialogTitle>
          <DialogDescription>
            {appTitle
              ? t('endUsers.descriptionNamed', { title: appTitle })
              : t('endUsers.description')}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className='text-sm text-muted-foreground'>{t('endUsers.loading')}</p>
        )}
        {error && <p className='text-sm text-destructive'>{error}</p>}

        {!loading && users.length === 0 && !error && (
          <p className='text-sm text-muted-foreground'>{t('endUsers.empty')}</p>
        )}

        {!loading && users.length > 0 && (
          <div className='space-y-4'>
            {users.map((user) => (
              <div
                key={user.id}
                className='rounded-lg border border-border p-4'
              >
                <div className='mb-3 flex flex-wrap items-start justify-between gap-2'>
                  <div>
                    <p className='font-medium'>{user.displayName || user.email}</p>
                    <p className='text-sm text-muted-foreground'>{user.email}</p>
                    <p className='text-xs text-muted-foreground'>
                      {t('endUsers.registeredAt', {
                        date: new Date(user.createdAt).toLocaleString(),
                      })}
                      {' · '}
                      {user.status === 'disabled'
                        ? t('endUsers.statusDisabled')
                        : t('endUsers.statusActive')}
                    </p>
                  </div>
                </div>
                <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                  {GRANT_KEYS.map((key) => (
                    <div key={key} className='flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2'>
                      <Label htmlFor={`${user.id}-${key}`} className='text-sm'>
                        {t(`endUsers.grants.${key}`)}
                      </Label>
                      <Switch
                        id={`${user.id}-${key}`}
                        checked={user.grants[key]}
                        disabled={savingUserId === user.id}
                        onCheckedChange={(checked) => void updateGrant(user.id, key, checked)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
