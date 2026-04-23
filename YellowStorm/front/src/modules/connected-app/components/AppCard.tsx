import { memo, useCallback, useState } from 'react';
import { Check, Loader2, Unplug, Plug } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useModuleTranslation } from '@/modules/localization';
import { useConnectedAppStore } from '../store';
import type { ConnectedAppWithStatus } from '../types';
import { AppIcon } from './AppIcon';

const MAILBOX_APP_KEYS = new Set(['microsoft', 'microsoft365', 'm365']);

interface AppCardProps {
  app: ConnectedAppWithStatus;
}

export const AppCard = memo(function AppCard({ app }: AppCardProps) {
  const { t } = useModuleTranslation('connected-app');
  const connectApp = useConnectedAppStore((s) => s.connectApp);
  const disconnectApp = useConnectedAppStore((s) => s.disconnectApp);
  const connectingAppKey = useConnectedAppStore((s) => s.connectingAppKey);
  const mailboxCapability = useConnectedAppStore((s) => s.mailboxCapability);

  const isConnecting = connectingAppKey === app.appKey;
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const isMailboxApp = MAILBOX_APP_KEYS.has(app.appKey);
  const showMailboxStatus = isMailboxApp && mailboxCapability?.appKey === app.appKey;

  const handleConnect = useCallback(() => {
    connectApp(app.appKey);
  }, [connectApp, app.appKey]);

  const handleDisconnect = useCallback(() => {
    disconnectApp(app.appKey);
    setConfirmDisconnect(false);
  }, [disconnectApp, app.appKey]);

  return (
    <>
      <Card className="relative overflow-hidden">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
            <AppIcon iconKey={app.iconKey || app.appKey} className="h-7 w-7" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{app.displayName}</h3>
              {app.connected && (
                <Badge variant="outline" className="shrink-0 text-green-600 border-green-300">
                  <Check className="mr-1 h-3 w-3" />
                  {t('card.connected')}
                </Badge>
              )}
            </div>
            {app.description && (
              <p className="text-sm text-muted-foreground truncate mt-0.5">
                {app.description}
              </p>
            )}
            {app.connection?.providerEmail && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('card.connectedAs', { email: app.connection.providerEmail })}
              </p>
            )}
            {showMailboxStatus && mailboxCapability?.connected && !mailboxCapability.mailboxReady && (
              <p className="text-xs text-amber-600 mt-1">
                {t('card.mailboxScopesMissing', { scopes: mailboxCapability.missingScopes.join(', ') })}
              </p>
            )}
            {showMailboxStatus && mailboxCapability?.mailboxReady && (
              <p className="text-xs text-green-600 mt-1">
                {t('card.mailboxReady')}
              </p>
            )}
          </div>

          <div className="shrink-0">
            {app.connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDisconnect(true)}
              >
                <Unplug className="mr-1.5 h-4 w-4" />
                {t('card.disconnect')}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleConnect}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="mr-1.5 h-4 w-4" />
                )}
                {t('card.connect')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('card.disconnect')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('card.confirmDisconnect', { appName: app.displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect}>
              {t('card.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
