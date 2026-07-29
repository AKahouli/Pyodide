import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';

import { parseApiError } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ErrorCode } from '@/lib/error-codes';
import { showSuccess, showWarning } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useWhatsAppPairingSocket } from '../hooks/useWhatsAppPairingSocket';
import { useWhatsAppIntegrationSse } from '../hooks/useWhatsAppIntegrationSse';
import {
  connectAgentWhatsApp,
  deleteAgentWhatsAppIntegration,
  disconnectAgentWhatsAppSession,
  getAgentWhatsAppIntegration,
  getAgentWhatsAppPairing,
  notifyAgentWhatsAppAutoRecover,
  reconnectAgentWhatsApp,
  updateAgentWhatsAppEnabled,
} from '../api';
import { Switch } from '@/components/ui/switch';
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
  agentName?: string;
  readOnly?: boolean;
}

export function AgentWhatsAppIntegrationSection({
  agentId,
  agentName,
  readOnly = false,
}: AgentWhatsAppIntegrationSectionProps) {
  const { t } = useModuleTranslation('agent');

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabledBusy, setEnabledBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [integration, setIntegration] = useState<AgentWhatsAppIntegration | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | undefined>();
  const [pairingCode, setPairingCode] = useState<string | undefined>();
  const autoRecoverRequestedRef = useRef<string | null>(null);
  const recoveryCompleteNotifiedRef = useRef(false);
  const integrationStatusRef = useRef<AgentWhatsAppIntegration['status'] | undefined>();

  const networkErrorLabel = t('createEdit.fields.whatsappNetworkUnreachable');
  const isFailed = isWhatsAppFailed(integration?.status);
  const isPairing = isWhatsAppPairing(integration?.status);
  const listenForRecoveryEvents = Boolean(!readOnly && agentId && sessionId && (isFailed || isPairing));

  const refreshIntegration = useCallback(async (id: string) => {
    const res = await getAgentWhatsAppIntegration(id);
    setIntegration(res);
    setEnabled(res?.enabled ?? false);
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
        setEnabled(res?.enabled ?? false);
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

  const notifyConnectedSuccess = useCallback(() => {
    if (recoveryCompleteNotifiedRef.current) return;
    recoveryCompleteNotifiedRef.current = true;
    showSuccess(t('createEdit.fields.whatsappConnected'));
  }, [t]);

  const handleConnected = useCallback(
    async (payload: { phoneNumber?: string }) => {
      if (!agentId) return;
      const refreshed = await refreshIntegration(agentId);
      setIntegration(
        refreshed ?? {
          enabled: true,
          status: 'CONNECTED',
          sessionId: sessionId ?? undefined,
          phoneNumber: payload.phoneNumber,
        },
      );
      setQrCode(undefined);
      setPairingCode(undefined);
      autoRecoverRequestedRef.current = null;
      notifyConnectedSuccess();
    },
    [agentId, refreshIntegration, sessionId, notifyConnectedSuccess],
  );

  const handleSseStatus = useCallback((status: AgentWhatsAppIntegration) => {
    const previousStatus = integrationStatusRef.current;
    if (isWhatsAppFailed(previousStatus) && isWhatsAppConnected(status.status)) {
      autoRecoverRequestedRef.current = null;
      notifyConnectedSuccess();
    }
    integrationStatusRef.current = status.status;
    setIntegration(status);
    setEnabled(status.enabled);
    if (status.sessionId) {
      setSessionId(status.sessionId);
    }
    if (isWhatsAppConnected(status.status)) {
      setQrCode(undefined);
      setPairingCode(undefined);
    }
  }, [notifyConnectedSuccess]);

  useEffect(() => {
    if (!agentId || !sessionId || !isFailed) {
      if (!isFailed) {
        autoRecoverRequestedRef.current = null;
      }
      return;
    }

    const recoveryKey = `${sessionId}:FAILED`;
    if (autoRecoverRequestedRef.current === recoveryKey) {
      return;
    }
    autoRecoverRequestedRef.current = recoveryKey;
    recoveryCompleteNotifiedRef.current = false;

    void notifyAgentWhatsAppAutoRecover(agentId).catch(() => {
      autoRecoverRequestedRef.current = null;
    });
  }, [agentId, sessionId, isFailed]);

  useEffect(() => {
    integrationStatusRef.current = integration?.status;
  }, [integration?.status]);

  useWhatsAppIntegrationSse({
    agentId,
    enabled: Boolean(agentId && sessionId && isFailed),
    onStatus: handleSseStatus,
  });

  useWhatsAppPairingSocket({
    agentId,
    sessionId,
    enabled: listenForRecoveryEvents,
    onQrGenerated: (payload) => applyPairingPayload(payload),
    onConnected: (payload) => {
      void handleConnected(payload);
    },
    onSessionFailed: (payload) => {
      setIntegration((prev) => ({
        enabled: prev?.enabled ?? true,
        status: 'FAILED',
        sessionId: payload.sessionId,
        errorMessage: payload.errorMessage,
        phoneNumber: prev?.phoneNumber,
      }));
      showWarning(t('createEdit.fields.whatsappStatusFailed'), {
        description: resolveWhatsAppErrorMessage(payload.errorMessage, networkErrorLabel),
      });
    },
    onDisconnected: () => {
      setIntegration((prev) =>
        prev ? { ...prev, status: 'DISCONNECTED' } : { enabled: false, status: 'DISCONNECTED' },
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
    if (readOnly) return;
    const res = await connectAgentWhatsApp(id);
    setSessionId(res.sessionId);
    setEnabled(true);
    setIntegration({
      enabled: true,
      status: 'PAIRING',
      sessionId: res.sessionId,
    });
    applyPairingPayload(res);
    showSuccess(t('createEdit.fields.whatsappPairingStarted'));
  };

  const handleConnect = async () => {
    if (readOnly || !agentId) return;
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

  const handleEnabledChange = async (nextEnabled: boolean) => {
    if (readOnly || !agentId) return;
    if (!integration) {
      setEnabled(nextEnabled);
      return;
    }

    const previousEnabled = enabled;
    setEnabled(nextEnabled);
    setEnabledBusy(true);
    try {
      const updated = await updateAgentWhatsAppEnabled(agentId, { enabled: nextEnabled });
      setIntegration(updated);
      setEnabled(updated.enabled);
      showSuccess(
        nextEnabled
          ? t('createEdit.fields.whatsappEnabled')
          : t('createEdit.fields.whatsappDisabled'),
      );
    } catch (err) {
      setEnabled(previousEnabled);
      showWarning(t('createEdit.fields.whatsappEnabledUpdateFailed'), {
        description: err instanceof Error ? err.message : t('list.errors.unknownError'),
      });
    } finally {
      setEnabledBusy(false);
    }
  };

  const handleRefreshPairing = async () => {
    if (readOnly || !agentId || !sessionId) return;
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
    if (readOnly) return;
    if (!agentId || !sessionId) {
      setIntegration(null);
      setEnabled(false);
      setSessionId(null);
      setQrCode(undefined);
      setPairingCode(undefined);
      return;
    }
    setBusy(true);
    try {
      await disconnectAgentWhatsAppSession(agentId, sessionId);
      setIntegration({ enabled, status: 'DISCONNECTED' });
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
    if (readOnly || !agentId) return;
    setBusy(true);
    try {
      if (sessionId) {
        await disconnectAgentWhatsAppSession(agentId, sessionId);
      } else {
        await deleteAgentWhatsAppIntegration(agentId);
      }
      setIntegration(null);
      setEnabled(false);
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
    if (readOnly || !agentId) return;
    setBusy(true);
    try {
      if (sessionId && integration?.status !== 'DISCONNECTED') {
        const updated = await reconnectAgentWhatsApp(agentId, sessionId);
        setIntegration(updated);
        setEnabled(updated.enabled);
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
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            {t('createEdit.fields.whatsappIntegration')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t('createEdit.fields.whatsappIntegrationDescription')}
          </p>
        </div>
        <Switch
          data-testid="whatsapp-enabled-switch"
          checked={enabled}
          disabled={readOnly || !agentId || loading || busy || enabledBusy}
          onCheckedChange={(checked) => void handleEnabledChange(checked)}
        />
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
              {agentName && (
                <p>
                  <span className="text-muted-foreground">
                    {t('createEdit.fields.whatsappAgentName')}:{' '}
                  </span>
                  {agentName}
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
            {enabled && notConnected && !pairing && (
              <Button
                type="button"
                size="sm"
                onClick={handleConnect}
                disabled={readOnly || busy || loading}
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
                  disabled={readOnly || busy || loading}
                  data-testid="whatsapp-refresh"
                >
                  {t('createEdit.fields.whatsappRefreshCode')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancelPairing}
                  disabled={readOnly || busy || loading}
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
                  disabled={readOnly || busy || loading}
                  data-testid="whatsapp-disconnect"
                >
                  {t('createEdit.fields.whatsappDisconnect')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleReconnect}
                  disabled={readOnly || busy || loading}
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
