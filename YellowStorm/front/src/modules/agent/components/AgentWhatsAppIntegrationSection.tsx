import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';

import { parseApiError } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ErrorCode } from '@/lib/error-codes';
import { showSuccess, showWarning } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useWhatsAppPairingSocket } from '../hooks/useWhatsAppPairingSocket';
import {
  connectAgentWhatsApp,
  deleteAgentWhatsAppIntegration,
  disconnectAgentWhatsAppSession,
  getAgentWhatsAppIntegration,
  getAgentWhatsAppPairing,
  reconnectAgentWhatsApp,
} from '../api';
import type { AgentWhatsAppIntegration } from '../types';
import {
  formatPairingCodeDisplay,
  isWhatsAppConnected,
  isWhatsAppFailed,
  isWhatsAppNotConnected,
  isWhatsAppPairing,
  normalizeQrDataUrl,
  resolveWhatsAppErrorMessage,
} from '@/lib/whatsapp-integration-utils';

const PAIRING_POLL_MS = 2500;

interface AgentWhatsAppIntegrationSectionProps {
  agentId: string | null;
}

export function AgentWhatsAppIntegrationSection({
  agentId,
}: AgentWhatsAppIntegrationSectionProps) {
  const { t } = useModuleTranslation('agent');

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [integration, setIntegration] = useState<AgentWhatsAppIntegration | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | undefined>();
  const [pairingCode, setPairingCode] = useState<string | undefined>();

  const networkErrorLabel = t('createEdit.fields.whatsappNetworkUnreachable');

  const refreshIntegration = useCallback(async (id: string) => {
    const res = await getAgentWhatsAppIntegration(id);
    setIntegration(res);
    if (res?.sessionId) {
      setSessionId(res.sessionId);
    }
    return res;
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!agentId) {
      setIntegration(null);
      setSessionId(null);
      setQrCode(undefined);
      setPairingCode(undefined);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    getAgentWhatsAppIntegration(agentId)
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

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const applyPairingPayload = useCallback((payload: { qrCode?: string; pairingCode?: string }) => {
    if (payload.qrCode) setQrCode(normalizeQrDataUrl(payload.qrCode));
    if (payload.pairingCode) setPairingCode(payload.pairingCode);
  }, []);

  const handleConnected = useCallback(
    async (payload: { phoneNumber?: string; displayName?: string }) => {
      if (!agentId) return;
      const refreshed = await refreshIntegration(agentId);
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
      showSuccess(t('createEdit.fields.whatsappConnected'));
    },
    [agentId, refreshIntegration, sessionId, t],
  );

  useWhatsAppPairingSocket({
    agentId,
    sessionId,
    enabled: Boolean(agentId && sessionId && isWhatsAppPairing(integration?.status)),
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
      showWarning(t('createEdit.fields.whatsappStatusFailed'), {
        description: resolveWhatsAppErrorMessage(payload.errorMessage, networkErrorLabel),
      });
    },
    onDisconnected: () => {
      setIntegration((prev) =>
        prev ? { ...prev, status: 'DISCONNECTED' } : { status: 'DISCONNECTED' },
      );
      setSessionId(null);
      setQrCode(undefined);
      setPairingCode(undefined);
    },
  });

  useEffect(() => {
    if (!agentId || !sessionId || !isWhatsAppPairing(integration?.status)) {
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;

    const poll = async () => {
      try {
        const res = await getAgentWhatsAppPairing(agentId, sessionId);
        if (!cancelled) applyPairingPayload(res);
      } catch (err) {
        // Polling fallback when Socket.IO misses events:
        // backend can move from PAIRING -> CONNECTED between polls.
        if (cancelled || refreshInFlight) return;
        const apiError = parseApiError(err);
        if (apiError.code !== ErrorCode.WHATSAPP_SESSION_NOT_PAIRING) return;

        refreshInFlight = true;
        try {
          const refreshed = await refreshIntegration(agentId);
          // Clear pairing visuals when backend has finished pairing.
          if (!cancelled && refreshed) {
            setQrCode(undefined);
            setPairingCode(undefined);
          }
        } finally {
          refreshInFlight = false;
        }
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), PAIRING_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [agentId, sessionId, integration?.status, applyPairingPayload, refreshIntegration]);

  const startPairing = async (id: string) => {
    const res = await connectAgentWhatsApp(id);
    setSessionId(res.sessionId);
    setIntegration({
      status: 'PAIRING',
      sessionId: res.sessionId,
    });
    applyPairingPayload(res);
    showSuccess(t('createEdit.fields.whatsappPairingStarted'));
  };

  const handleConnect = async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      await startPairing(agentId);
    } catch (err) {
      showWarning(t('createEdit.fields.whatsappConnectFailed'), {
        description: err instanceof Error ? err.message : t('list.errors.unknownError'),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshPairing = async () => {
    if (!agentId || !sessionId) return;
    setBusy(true);
    try {
      const res = await getAgentWhatsAppPairing(agentId, sessionId);
      applyPairingPayload(res);
    } catch (err) {
      showWarning(t('createEdit.fields.whatsappRefreshFailed'), {
        description: err instanceof Error ? err.message : t('list.errors.unknownError'),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCancelPairing = async () => {
    if (!agentId || !sessionId) {
      setIntegration(null);
      setSessionId(null);
      setQrCode(undefined);
      setPairingCode(undefined);
      return;
    }
    setBusy(true);
    try {
      await disconnectAgentWhatsAppSession(agentId, sessionId);
      setIntegration({ status: 'DISCONNECTED' });
      setSessionId(null);
      setQrCode(undefined);
      setPairingCode(undefined);
      showSuccess(t('createEdit.fields.whatsappPairingCancelled'));
    } catch (err) {
      showWarning(t('createEdit.fields.whatsappDisconnectFailed'), {
        description: err instanceof Error ? err.message : t('list.errors.unknownError'),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      if (sessionId) {
        await disconnectAgentWhatsAppSession(agentId, sessionId);
      } else {
        await deleteAgentWhatsAppIntegration(agentId);
      }
      setIntegration(null);
      setSessionId(null);
      setQrCode(undefined);
      setPairingCode(undefined);
      showSuccess(t('createEdit.fields.whatsappDisconnected'));
    } catch (err) {
      showWarning(t('createEdit.fields.whatsappDisconnectFailed'), {
        description: err instanceof Error ? err.message : t('list.errors.unknownError'),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReconnect = async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      if (sessionId && integration?.status !== 'DISCONNECTED') {
        const updated = await reconnectAgentWhatsApp(agentId, sessionId);
        setIntegration(updated);
        if (updated.status === 'PAIRING') {
          setSessionId(updated.sessionId ?? sessionId);
          if (updated.sessionId) {
            const pairing = await getAgentWhatsAppPairing(agentId, updated.sessionId);
            applyPairingPayload(pairing);
          }
        }
      } else {
        await startPairing(agentId);
      }
    } catch (err) {
      showWarning(t('createEdit.fields.whatsappReconnectFailed'), {
        description: err instanceof Error ? err.message : t('list.errors.unknownError'),
      });
    } finally {
      setBusy(false);
    }
  };

  const status = integration?.status;
  const notConnected = isWhatsAppNotConnected(integration);
  const pairing = isWhatsAppPairing(status);
  const connected = isWhatsAppConnected(status);
  const failed = isWhatsAppFailed(status);
  const displayPairingCode = formatPairingCodeDisplay(pairingCode);

  const statusLabel = (() => {
    if (pairing) return t('createEdit.fields.whatsappStatusPairing');
    if (connected) return t('createEdit.fields.whatsappStatusConnected');
    if (failed) return t('createEdit.fields.whatsappStatusFailed');
    return t('createEdit.fields.whatsappStatusNotConnected');
  })();

  const isWarningBanner = failed;
  const isSuccessBanner = connected;

  return (
    <div className="space-y-3 rounded-md border p-4" data-testid="whatsapp-integration-section">
      <div className="space-y-1">
        <Label className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          {t('createEdit.fields.whatsappIntegration')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('createEdit.fields.whatsappIntegrationDescription')}
        </p>
      </div>

      {!agentId && (
        <p className="text-xs text-muted-foreground">
          {t('createEdit.fields.whatsappRequiresAgent')}
        </p>
      )}

      {agentId && (
        <>
          <div
            className={cn(
              'rounded-md border p-3 text-sm',
              isSuccessBanner &&
                'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100',
              isWarningBanner &&
                'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
              !isSuccessBanner &&
                !isWarningBanner &&
                'border-muted bg-muted/40 text-foreground',
            )}
          >
            <div className="flex items-start gap-2">
              {isSuccessBanner ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div className="space-y-1">
                <p className="font-medium">{statusLabel}</p>
                {notConnected && !loading && (
                  <p className="text-xs opacity-90">
                    {t('createEdit.fields.whatsappNotConnectedDescription')}
                  </p>
                )}
                {failed && integration?.errorMessage && (
                  <p className="text-xs opacity-90">
                    {resolveWhatsAppErrorMessage(integration.errorMessage, networkErrorLabel)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {connected && (
            <div className="grid gap-2 text-sm">
              {integration?.phoneNumber && (
                <p>
                  <span className="text-muted-foreground">
                    {t('createEdit.fields.whatsappPhoneNumber')}:{' '}
                  </span>
                  {integration.phoneNumber}
                </p>
              )}
              {integration?.displayName && (
                <p>
                  <span className="text-muted-foreground">
                    {t('createEdit.fields.whatsappDisplayName')}:{' '}
                  </span>
                  {integration.displayName}
                </p>
              )}
            </div>
          )}

          {pairing && (
            <div className="space-y-3 rounded-md border border-dashed p-3">
              {qrCode && (
                <img
                  src={qrCode}
                  alt={t('createEdit.fields.whatsappQrAlt')}
                  className="mx-auto h-48 w-48 rounded-md border bg-white object-contain p-2"
                  data-testid="whatsapp-qr"
                />
              )}
              {displayPairingCode && (
                <p
                  className="text-center font-mono text-lg tracking-widest"
                  data-testid="whatsapp-pairing-code"
                >
                  {t('createEdit.fields.whatsappPairingCodeLabel', {
                    code: displayPairingCode,
                  })}
                </p>
              )}
              {!qrCode && !displayPairingCode && (
                <p className="text-center text-xs text-muted-foreground">
                  {t('createEdit.fields.whatsappWaitingPairingData')}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {notConnected && !pairing && (
              <Button
                type="button"
                size="sm"
                onClick={handleConnect}
                disabled={busy || loading}
                data-testid="whatsapp-connect"
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('createEdit.actions.saving')}
                  </>
                ) : (
                  t('createEdit.fields.whatsappConnect')
                )}
              </Button>
            )}

            {pairing && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshPairing}
                  disabled={busy || loading}
                  data-testid="whatsapp-refresh"
                >
                  {t('createEdit.fields.whatsappRefreshCode')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancelPairing}
                  disabled={busy || loading}
                  data-testid="whatsapp-cancel"
                >
                  {t('createEdit.fields.whatsappCancel')}
                </Button>
              </>
            )}

            {(connected || failed) && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={busy || loading}
                  data-testid="whatsapp-disconnect"
                >
                  {t('createEdit.fields.whatsappDisconnect')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleReconnect}
                  disabled={busy || loading}
                  data-testid="whatsapp-reconnect"
                >
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('createEdit.actions.saving')}
                    </>
                  ) : (
                    t('createEdit.fields.whatsappReconnect')
                  )}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
