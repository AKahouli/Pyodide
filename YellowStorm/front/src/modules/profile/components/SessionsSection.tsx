/**
 * Sessions Section
 * View and manage active sessions
 */

import * as React from 'react';
import { Loader2, Laptop, Smartphone, Monitor, Globe, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import type { Session } from '../types';
import * as profileApi from '../api';

export function SessionsSection() {
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const { t } = useModuleTranslation('profile');
  const { t: tCommon } = useModuleTranslation('common');

  const fetchSessions = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await profileApi.getSessions();
      setSessions(data);
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) {
        setError((err as { message: string }).message);
      } else {
        setError(t('sessions.errors.load'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      await profileApi.revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      // Session might have already been invalidated
      fetchSessions();
    } finally {
      setRevokingId(null);
    }
  };

  const getDeviceIcon = (session: Session) => {
    const device = session.deviceInfo.device?.toLowerCase() || '';
    const os = session.deviceInfo.os?.toLowerCase() || '';

    if (device.includes('mobile') || device.includes('phone')) {
      return <Smartphone className='h-5 w-5' />;
    }
    if (os.includes('windows') || os.includes('mac') || os.includes('linux')) {
      return <Laptop className='h-5 w-5' />;
    }
    return <Monitor className='h-5 w-5' />;
  };

  const getDeviceDescription = (session: Session) => {
    const parts = [];
    if (session.deviceInfo.browser) parts.push(session.deviceInfo.browser);
    if (session.deviceInfo.os) parts.push(session.deviceInfo.os);
    return parts.length ? parts.join(t('sessions.device.separator')) : t('sessions.device.unknown');
  };

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-xl font-semibold'>{t('sessions.title')}</h2>
        <p className='text-sm text-muted-foreground'>{t('sessions.description')}</p>
      </div>

      <Separator />

      {error && <div className='rounded-md bg-destructive/10 p-3 text-sm text-destructive'>{error}</div>}

      <div className='space-y-4'>
        {sessions.length === 0 ? (
          <p className='text-sm text-muted-foreground py-4'>{t('sessions.empty')}</p>
        ) : (
          sessions.map((session) => (
            <Card key={session.id} className={session.isCurrent ? 'border-primary' : ''}>
              <CardHeader className='pb-3'>
                <div className='flex items-start justify-between'>
                  <div className='flex items-center gap-3'>
                    <div className='text-muted-foreground'>{getDeviceIcon(session)}</div>
                    <div>
                      <CardTitle className='text-base flex items-center gap-2'>
                        {getDeviceDescription(session)}
                        {session.isCurrent && (
                          <Badge variant='secondary' className='text-xs'>
                            {t('sessions.badges.current')}
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className='flex items-center gap-1 mt-1'>
                        <Globe className='h-3 w-3' />
                        {session.ipAddress}
                      </CardDescription>
                    </div>
                  </div>

                  {!session.isCurrent && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant='ghost' size='sm' className='text-destructive hover:text-destructive' disabled={revokingId === session.id}>
                          {revokingId === session.id ? <Loader2 className='h-4 w-4 animate-spin' /> : <Trash2 className='h-4 w-4' />}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('sessions.revoke.title')}</AlertDialogTitle>
                          <AlertDialogDescription>{t('sessions.revoke.description')}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{tCommon('actionCancel')}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleRevokeSession(session.id)} className='bg-destructive text-destructive-foreground hover:bg-destructive/90'>
                            {t('sessions.revoke.action')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </CardHeader>
              <CardContent className='pt-0'>
                <div className='text-xs text-muted-foreground'>
                  {t('sessions.timestamps.lastActive', {
                    time: formatDistanceToNow(new Date(session.lastActivityAt), { addSuffix: true }),
                  })}
                  {' · '}
                  {t('sessions.timestamps.created', {
                    time: formatDistanceToNow(new Date(session.createdAt), { addSuffix: true }),
                  })}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Separator />

      <div className='flex items-center justify-between'>
        <div>
          <p className='text-sm font-medium'>{t('sessions.signOutAll.title')}</p>
          <p className='text-xs text-muted-foreground'>{t('sessions.signOutAll.description')}</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant='outline' className='text-destructive border-destructive hover:bg-destructive/10'>
              {t('sessions.signOutAll.button')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('sessions.signOutAll.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('sessions.signOutAll.confirmDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon('actionCancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  const otherSessions = sessions.filter((s) => !s.isCurrent);
                  for (const session of otherSessions) {
                    await handleRevokeSession(session.id);
                  }
                }}
                className='bg-destructive text-destructive-foreground hover:bg-destructive/90'>
                {t('sessions.signOutAll.confirmAction')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
