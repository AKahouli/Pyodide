import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { showSuccess, showWarning } from '@/lib/notifications';
import {
  formatPairingCodeDisplay,
  isWhatsAppConnected,
  isWhatsAppFailed,
  isWhatsAppNotConnected,
  isWhatsAppPairing,
  normalizeQrDataUrl,
  resolveWhatsAppApiError,
  resolveWhatsAppErrorMessage,
} from '@/lib/whatsapp-integration-utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  connectWorkyWhatsApp,
  deleteWorkyWhatsAppIntegration,
  disconnectWorkyWhatsAppSession,
  getWorkyWhatsAppIntegration,
  getWorkyWhatsAppPairing,
  getWorkyWhatsAppSystemBotStatus,
  reconnectWorkyWhatsApp,
} from '../api';
import { useWorkyWhatsAppPairingSocket } from '../hooks/useWorkyWhatsAppPairingSocket';
import { workyKeys } from '../query/queryKeys';
import type { WorkyWhatsAppIntegration } from '../types';

const PAIRING_POLL_MS = 2500;

interface WorkyWhatsAppConnectModalProps {
  open: boolean;
  streamId: string;
  onClose: () => void;
}

export function WorkyWhatsAppConnectModal({
  open,
  streamId,
  onClose,
}: WorkyWhatsAppConnectModalProps): JSX.Element | null {
  const { t } = useModuleTranslation('worky');
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [integration, setIntegration] = useState<WorkyWhatsAppIntegration | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | undefined>();
  const [pairingCode, setPairingCode] = useState<string | undefined>();
  const [systemBotConnected, setSystemBotConnected] = useState<boolean | null>(null);

  const networkErrorLabel = t('whatsapp.networkUnreachable');

  const invalidateIntegration = useCallback(() => {
    void qc.invalidateQueries({ queryKey: workyKeys.whatsappIntegration(streamId) });
  }, [qc, streamId]);

  const refreshIntegration = useCallback(async () => {
    const res = await getWorkyWhatsAppIntegration(streamId);
    setIntegration(res);
    if (res?.sessionId) setSessionId(res.sessionId);
    invalidateIntegration();
    return res;
  }, [streamId, invalidateIntegration]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setConnectError(null);
    getWorkyWhatsAppIntegration(streamId)
      .then((res) => {
        if (cancelled) return;
        setIntegration(res);
        setSessionId(res?.sessionId ?? null);
        setQrCode(undefined);
        setPairingCode(undefined);
      })
      .catch(() => {
        if (!cancelled) setIntegration(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    getWorkyWhatsAppSystemBotStatus()
      .then((status) => {
        if (!cancelled) setSystemBotConnected(status.connected);
      })
      .catch(() => {
        if (!cancelled) setSystemBotConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, streamId]);

  const applyPairingPayload = useCallback((payload: { qrCode?: string; pairingCode?: string }) => {
    if (payload.qrCode) setQrCode(normalizeQrDataUrl(payload.qrCode));
    if (payload.pairingCode) setPairingCode(payload.pairingCode);
  }, []);

  const handleConnected = useCallback(
    async (payload: { phoneNumber?: string; displayName?: string }) => {
      const refreshed = await refreshIntegration();
      setIntegration(
        refreshed ?? {
          status: 'CONNECTED',
          sessionId: sessionId ?? undefined,
          phoneNumber: payload.phoneNumber,
          displayName: payload.displayName,
        },
      );
      setQrCode(undefined);
      setPairingCode(undefined);
      setConnectError(null);
      showSuccess(t('whatsapp.connected'));
    },
    [refreshIntegration, sessionId, t],
  );

  useWorkyWhatsAppPairingSocket({
    streamId,
    sessionId,
    enabled: Boolean(open && streamId && sessionId && isWhatsAppPairing(integration?.status)),
    onQrGenerated: (payload) => applyPairingPayload(payload),
    onConnected: (payload) => {
      void handleConnected(payload);
    },
    onSessionFailed: (payload) => {
      setIntegration((prev) => ({
        status: 'FAILED',
        sessionId: payload.sessionId,
        errorMessage: payload.errorMessage,
        phoneNumber: prev?.phoneNumber,
        displayName: prev?.displayName,
      }));
      showWarning(t('whatsapp.statusFailed'), {
        description: resolveWhatsAppErrorMessage(payload.errorMessage, networkErrorLabel),
      });
      invalidateIntegration();
    },
    onDisconnected: () => {
      setIntegration((prev) =>
        prev ? { ...prev, status: 'DISCONNECTED' } : { status: 'DISCONNECTED' },
      );
      setSessionId(null);
      setQrCode(undefined);
      setPairingCode(undefined);
      invalidateIntegration();
    },
  });

  useEffect(() => {
    if (!open || !sessionId || !isWhatsAppPairing(integration?.status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await getWorkyWhatsAppPairing(streamId, sessionId);
        if (!cancelled) applyPairingPayload(res);
      } catch {
        // HTTP polling fallback when Socket.IO misses events
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), PAIRING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, streamId, sessionId, integration?.status, applyPairingPayload]);

  const startPairing = async () => {
    const res = await connectWorkyWhatsApp(streamId);
    setSessionId(res.sessionId);
    setIntegration({ status: 'PAIRING', sessionId: res.sessionId });
    applyPairingPayload(res);
    setConnectError(null);
    invalidateIntegration();
  };

  const handleConnect = async () => {
    setBusy(true);
    setConnectError(null);
    try {
      await startPairing();
    } catch (err) {
      const description = resolveWhatsAppApiError(err, networkErrorLabel);
      setConnectError(description);
      showWarning(t('whatsapp.connectFailed'), { description });
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshPairing = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const res = await getWorkyWhatsAppPairing(streamId, sessionId);
      applyPairingPayload(res);
    } catch (err) {
      showWarning(t('whatsapp.refreshFailed'), {
        description: resolveWhatsAppApiError(err, networkErrorLabel),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCancelPairing = async () => {
    if (!sessionId) {
      setIntegration(null);
      setQrCode(undefined);
      setPairingCode(undefined);
      return;
    }
    setBusy(true);
    try {
      await disconnectWorkyWhatsAppSession(streamId, sessionId);
      setIntegration({ status: 'DISCONNECTED' });
      setSessionId(null);
      setQrCode(undefined);
      setPairingCode(undefined);
      invalidateIntegration();
      showSuccess(t('whatsapp.pairingCancelled'));
    } catch (err) {
      showWarning(t('whatsapp.disconnectFailed'), {
        description: resolveWhatsAppApiError(err, networkErrorLabel),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      if (sessionId) {
        await disconnectWorkyWhatsAppSession(streamId, sessionId);
      } else {
        await deleteWorkyWhatsAppIntegration(streamId);
      }
      setIntegration(null);
      setSessionId(null);
      setQrCode(undefined);
      setPairingCode(undefined);
      setConnectError(null);
      invalidateIntegration();
      showSuccess(t('whatsapp.disconnected'));
    } catch (err) {
      showWarning(t('whatsapp.disconnectFailed'), {
        description: resolveWhatsAppApiError(err, networkErrorLabel),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReconnect = async () => {
    setBusy(true);
    setConnectError(null);
    try {
      if (sessionId && integration?.status !== 'DISCONNECTED') {
        const updated = await reconnectWorkyWhatsApp(streamId, sessionId);
        setIntegration(updated);
        if (updated.status === 'PAIRING') {
          setSessionId(updated.sessionId ?? sessionId);
          if (updated.sessionId) {
            const pairing = await getWorkyWhatsAppPairing(streamId, updated.sessionId);
            applyPairingPayload(pairing);
          }
        }
      } else {
        await startPairing();
      }
      invalidateIntegration();
    } catch (err) {
      const description = resolveWhatsAppApiError(err, networkErrorLabel);
      setConnectError(description);
      showWarning(t('whatsapp.reconnectFailed'), { description });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const status = integration?.status;
  const notConnected = isWhatsAppNotConnected(integration);
  const pairing = isWhatsAppPairing(status);
  const connected = isWhatsAppConnected(status);
  const failed = isWhatsAppFailed(status);
  const displayPairingCode = formatPairingCodeDisplay(pairingCode);

  const statusLabel = (() => {
    if (loading) return t('whatsapp.loading');
    if (pairing) return t('whatsapp.statusPairing');
    if (connected) return t('whatsapp.statusConnected');
    if (failed) return t('whatsapp.statusFailed');
    return t('whatsapp.statusDisconnected');
  })();

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
      role='presentation'
      onClick={onClose}
      data-testid='worky-whatsapp-modal-backdrop'
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='worky-whatsapp-modal-title'
        className='w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-lg'
        onClick={(e) => e.stopPropagation()}
        data-testid='worky-whatsapp-modal'
      >
        <div className='mb-3 flex items-start justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <MessageCircle className='h-5 w-5' />
            <h2 id='worky-whatsapp-modal-title' className='text-sm font-semibold'>
              {t('whatsapp.modalTitle')}
            </h2>
          </div>
          <Button type='button' size='icon' variant='ghost' onClick={onClose} aria-label={t('actions.cancel')}>
            <X className='h-4 w-4' />
          </Button>
        </div>

        <p className='mb-3 text-xs text-muted-foreground'>{t('whatsapp.modalDescription')}</p>

        {systemBotConnected === false ? (
          <p
            className='mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'
            data-testid='worky-whatsapp-system-bot-banner'
          >
            {t('whatsapp.systemBotRequired')}{' '}
            <Link to='/admin/worky-whatsapp-system' className='font-medium underline'>
              {t('whatsapp.systemBotAdminLink')}
            </Link>
          </p>
        ) : null}

        {connectError ? (
          <p
            className='mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'
            data-testid='worky-whatsapp-connect-error'
          >
            {connectError}
          </p>
        ) : null}

        <div
          className={cn(
            'mb-3 rounded-md border p-3 text-sm',
            connected &&
              'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100',
            failed &&
              'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
            !connected && !failed && 'border-muted bg-muted/40',
          )}
        >
          <div className='flex items-start gap-2'>
            {loading ? (
              <Loader2 className='mt-0.5 h-4 w-4 shrink-0 animate-spin' />
            ) : connected ? (
              <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0' />
            ) : (
              <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
            )}
            <div>
              <p className='font-medium'>{statusLabel}</p>
              {failed && integration?.errorMessage ? (
                <p className='mt-1 text-xs opacity-90'>
                  {resolveWhatsAppErrorMessage(integration.errorMessage, networkErrorLabel)}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {pairing ? (
          <div className='mb-3 space-y-2 rounded-md border border-dashed p-3'>
            {qrCode ? (
              <img
                src={qrCode}
                alt={t('whatsapp.qrAlt')}
                className='mx-auto h-48 w-48 rounded-md border bg-white object-contain p-2'
                data-testid='worky-whatsapp-qr'
              />
            ) : (
              <p className='text-center text-xs text-muted-foreground'>{t('whatsapp.scanQr')}</p>
            )}
            {displayPairingCode ? (
              <p className='text-center font-mono text-lg tracking-widest' data-testid='worky-whatsapp-pairing-code'>
                {displayPairingCode}
              </p>
            ) : null}
          </div>
        ) : null}

        {connected && integration?.phoneNumber ? (
          <p className='mb-3 text-sm'>
            <span className='text-muted-foreground'>{t('whatsapp.phoneNumber')}: </span>
            {integration.phoneNumber}
          </p>
        ) : null}

        <div className='flex flex-wrap justify-end gap-2'>
          {notConnected && !pairing && !loading ? (
            <Button
              type='button'
              size='sm'
              onClick={handleConnect}
              disabled={busy || systemBotConnected === false}
              data-testid='worky-whatsapp-connect'
            >
              {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : t('whatsapp.connect')}
            </Button>
          ) : null}

          {pairing ? (
            <>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={handleRefreshPairing}
                disabled={busy || loading}
                data-testid='worky-whatsapp-refresh'
              >
                {t('whatsapp.refreshCode')}
              </Button>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={handleCancelPairing}
                disabled={busy || loading}
                data-testid='worky-whatsapp-cancel'
              >
                {t('whatsapp.cancel')}
              </Button>
            </>
          ) : null}

          {(connected || failed) && sessionId ? (
            <>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={handleDisconnect}
                disabled={busy || loading}
                data-testid='worky-whatsapp-disconnect'
              >
                {t('whatsapp.disconnect')}
              </Button>
              <Button
                type='button'
                size='sm'
                onClick={handleReconnect}
                disabled={busy || loading}
                data-testid='worky-whatsapp-reconnect'
              >
                {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : t('whatsapp.reconnect')}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
