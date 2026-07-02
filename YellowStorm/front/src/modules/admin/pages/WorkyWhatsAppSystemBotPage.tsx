import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, Pencil, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { WorkyWhatsAppIntegration } from '@/modules/worky/types';
import {
  connectAdminWorkyWhatsAppSystemBot,
  disconnectAdminWorkyWhatsAppSystemBot,
  getAdminWorkyWhatsAppSystemBot,
  getAdminWorkyWhatsAppSystemBotPairing,
  reconnectAdminWorkyWhatsAppSystemBot,
  updateAdminWorkyWhatsAppSystemBotExpectedPhone,
} from '../api';
import { useWorkySystemBotPairingSocket } from '../hooks/useWorkySystemBotPairingSocket';

const PAIRING_POLL_MS = 2500;

export function WorkyWhatsAppSystemBotPage(): JSX.Element {
  const { t } = useModuleTranslation('admin');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [integration, setIntegration] = useState<WorkyWhatsAppIntegration | null>(null);
  const [expectedPhoneInput, setExpectedPhoneInput] = useState('');
  const [isEditingPhone, setIsEditingPhone] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | undefined>();
  const [pairingCode, setPairingCode] = useState<string | undefined>();

  const networkErrorLabel = t('workyWhatsAppSystem.networkUnreachable');

  const refreshIntegration = useCallback(async () => {
    const res = await getAdminWorkyWhatsAppSystemBot();
    setIntegration(res);
    setExpectedPhoneInput(res?.expectedPairingPhone ?? '');
    if (res?.sessionId) setSessionId(res.sessionId);
    return res;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminWorkyWhatsAppSystemBot()
      .then((res) => {
        if (cancelled) return;
        setIntegration(res);
        setExpectedPhoneInput(res?.expectedPairingPhone ?? '');
        setIsEditingPhone(!res?.expectedPairingPhone?.trim());
        setSessionId(res?.sessionId ?? null);
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
  }, []);

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
      showSuccess(t('workyWhatsAppSystem.connected'));
    },
    [refreshIntegration, sessionId, t],
  );

  useWorkySystemBotPairingSocket({
    sessionId,
    enabled: Boolean(sessionId && isWhatsAppPairing(integration?.status)),
    onQrGenerated: (payload) => applyPairingPayload(payload),
    onConnected: (payload) => {
      void handleConnected(payload);
    },
    onSessionFailed: (payload) => {
      setIntegration({
        status: 'FAILED',
        sessionId: payload.sessionId,
        errorMessage: payload.errorMessage,
      });
      showWarning(t('workyWhatsAppSystem.statusFailed'), {
        description: resolveWhatsAppErrorMessage(payload.errorMessage, networkErrorLabel),
      });
    },
    onDisconnected: () => {
      setIntegration({ status: 'DISCONNECTED' });
      setSessionId(null);
      setQrCode(undefined);
      setPairingCode(undefined);
    },
  });

  useEffect(() => {
    if (!sessionId || !isWhatsAppPairing(integration?.status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await getAdminWorkyWhatsAppSystemBotPairing(sessionId);
        if (!cancelled) applyPairingPayload(res);
      } catch {
        // HTTP fallback when Socket.IO misses events
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), PAIRING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, integration?.status, applyPairingPayload]);

  const startPairing = async () => {
    const res = await connectAdminWorkyWhatsAppSystemBot();
    setSessionId(res.sessionId);
    setIntegration({ status: 'PAIRING', sessionId: res.sessionId });
    applyPairingPayload(res);
    setConnectError(null);
  };

  const status = integration?.status;
  const savedExpectedPhone = integration?.expectedPairingPhone?.trim() ?? '';
  const hasSavedPhone = Boolean(savedExpectedPhone);
  const phoneDirty = expectedPhoneInput.trim() !== savedExpectedPhone;
  const canConnect = hasSavedPhone;
  const notConnected = isWhatsAppNotConnected(integration);
  const pairing = isWhatsAppPairing(status);
  const connected = isWhatsAppConnected(status);
  const failed = isWhatsAppFailed(status);
  const displayPairingCode = formatPairingCodeDisplay(pairingCode);
  const phoneSectionLocked = busy || pairing;

  const handleSavePhone = () => {
    setBusy(true);
    void updateAdminWorkyWhatsAppSystemBotExpectedPhone(expectedPhoneInput.trim())
      .then((res) => {
        setIntegration(res);
        setExpectedPhoneInput(res.expectedPairingPhone ?? '');
        setIsEditingPhone(false);
        setConnectError(null);
        showSuccess(t('workyWhatsAppSystem.phoneSaved'));
      })
      .catch((err) => {
        const description = resolveWhatsAppApiError(err, networkErrorLabel);
        showWarning(t('workyWhatsAppSystem.phoneSaveFailed'), { description });
      })
      .finally(() => setBusy(false));
  };

  const handleCancelPhoneEdit = () => {
    setExpectedPhoneInput(savedExpectedPhone);
    setIsEditingPhone(false);
  };

  return (
    <div className='mx-auto max-w-2xl space-y-4 p-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <MessageCircle className='h-5 w-5' />
            {t('workyWhatsAppSystem.title')}
          </CardTitle>
          <CardDescription>{t('workyWhatsAppSystem.description')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <section className='space-y-3'>
            <div className='space-y-1'>
              <h3 className='text-sm font-medium'>{t('workyWhatsAppSystem.phoneSectionTitle')}</h3>
              <p className='text-sm text-muted-foreground'>
                {hasSavedPhone && !isEditingPhone
                  ? t('workyWhatsAppSystem.phoneConfiguredHint')
                  : t('workyWhatsAppSystem.phoneHint')}
              </p>
            </div>

            {hasSavedPhone && !isEditingPhone ? (
              <div className='flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between'>
                <div className='flex items-start gap-3'>
                  <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'>
                    <Phone className='h-4 w-4' />
                  </div>
                  <div className='space-y-1'>
                    <p className='text-xs font-medium text-muted-foreground'>
                      {t('workyWhatsAppSystem.expectedPhoneLabel')}
                    </p>
                    <p
                      className='font-mono text-base font-semibold tracking-wide'
                      data-testid='worky-system-bot-saved-phone'
                    >
                      {savedExpectedPhone}
                    </p>
                    <Badge variant='secondary' className='text-xs'>
                      {t('workyWhatsAppSystem.phoneConfiguredBadge')}
                    </Badge>
                  </div>
                </div>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='shrink-0'
                  disabled={phoneSectionLocked}
                  onClick={() => setIsEditingPhone(true)}
                  data-testid='worky-system-bot-modify-phone'
                >
                  <Pencil className='h-4 w-4' />
                  {t('workyWhatsAppSystem.modifyPhone')}
                </Button>
              </div>
            ) : (
              <div className='space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4'>
                <Label htmlFor='worky-system-bot-phone' className='text-xs font-medium'>
                  {t('workyWhatsAppSystem.expectedPhoneLabel')}
                </Label>
                <Input
                  id='worky-system-bot-phone'
                  type='tel'
                  inputMode='tel'
                  autoComplete='tel'
                  value={expectedPhoneInput}
                  onChange={(e) => setExpectedPhoneInput(e.target.value)}
                  placeholder={t('workyWhatsAppSystem.expectedPhonePlaceholder')}
                  disabled={phoneSectionLocked}
                  className='h-9 font-mono text-sm'
                  data-testid='worky-system-bot-expected-phone'
                />
                <div className='flex flex-wrap gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    disabled={
                      phoneSectionLocked ||
                      !expectedPhoneInput.trim() ||
                      (hasSavedPhone && !phoneDirty)
                    }
                    onClick={handleSavePhone}
                    data-testid='worky-system-bot-save-phone'
                  >
                    {busy ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : hasSavedPhone ? (
                      t('workyWhatsAppSystem.updatePhone')
                    ) : (
                      t('workyWhatsAppSystem.savePhone')
                    )}
                  </Button>
                  {hasSavedPhone ? (
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      disabled={phoneSectionLocked}
                      onClick={handleCancelPhoneEdit}
                    >
                      {t('workyWhatsAppSystem.cancelEditPhone')}
                    </Button>
                  ) : null}
                </div>
                {!canConnect && !loading ? (
                  <p className='text-xs text-amber-700 dark:text-amber-300'>
                    {t('workyWhatsAppSystem.phoneRequiredForConnect')}
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <section className='space-y-3'>
            <h3 className='text-sm font-medium'>{t('workyWhatsAppSystem.connectionSectionTitle')}</h3>

          {connectError ? (
            <p className='rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
              {connectError}
            </p>
          ) : null}

          <div
            className={cn(
              'rounded-md border p-3 text-sm',
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
                <p className='font-medium'>
                  {loading
                    ? t('workyWhatsAppSystem.loading')
                    : pairing
                      ? t('workyWhatsAppSystem.statusPairing')
                      : connected
                        ? t('workyWhatsAppSystem.statusConnected')
                        : failed
                          ? t('workyWhatsAppSystem.statusFailed')
                          : t('workyWhatsAppSystem.statusDisconnected')}
                </p>
                {failed && integration?.errorMessage ? (
                  <p className='mt-1 text-xs opacity-90'>
                    {resolveWhatsAppErrorMessage(integration.errorMessage, networkErrorLabel)}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {pairing ? (
            <div className='space-y-2 rounded-md border border-dashed p-3'>
              {qrCode ? (
                <img
                  src={qrCode}
                  alt={t('workyWhatsAppSystem.qrAlt')}
                  className='mx-auto h-48 w-48 rounded-md border bg-white object-contain p-2'
                />
              ) : (
                <p className='text-center text-xs text-muted-foreground'>
                  {t('workyWhatsAppSystem.scanQr')}
                </p>
              )}
              {displayPairingCode ? (
                <p className='text-center font-mono text-lg tracking-widest'>{displayPairingCode}</p>
              ) : null}
            </div>
          ) : null}

          {connected && integration?.phoneNumber ? (
            <p className='text-sm'>
              <span className='text-muted-foreground'>{t('workyWhatsAppSystem.phoneNumber')}: </span>
              {integration.phoneNumber}
            </p>
          ) : null}

          <div className='flex flex-wrap gap-2'>
            {notConnected && !pairing && !loading ? (
              <Button
                type='button'
                size='sm'
                disabled={busy || !canConnect}
                title={!canConnect ? t('workyWhatsAppSystem.phoneRequiredForConnect') : undefined}
                onClick={() => {
                  setBusy(true);
                  void startPairing()
                    .catch((err) => {
                      const description = resolveWhatsAppApiError(err, networkErrorLabel);
                      setConnectError(description);
                      showWarning(t('workyWhatsAppSystem.connectFailed'), { description });
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : t('workyWhatsAppSystem.connect')}
              </Button>
            ) : null}

            {pairing && sessionId ? (
              <>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void getAdminWorkyWhatsAppSystemBotPairing(sessionId)
                      .then(applyPairingPayload)
                      .catch((err) =>
                        showWarning(t('workyWhatsAppSystem.refreshFailed'), {
                          description: resolveWhatsAppApiError(err, networkErrorLabel),
                        }),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  {t('workyWhatsAppSystem.refreshCode')}
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void disconnectAdminWorkyWhatsAppSystemBot(sessionId)
                      .then(() => {
                        setIntegration({ status: 'DISCONNECTED' });
                        setSessionId(null);
                        setQrCode(undefined);
                        showSuccess(t('workyWhatsAppSystem.pairingCancelled'));
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  {t('workyWhatsAppSystem.cancel')}
                </Button>
              </>
            ) : null}

            {(connected || failed) && sessionId ? (
              <>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void disconnectAdminWorkyWhatsAppSystemBot(sessionId)
                      .then(() => {
                        setIntegration(null);
                        setSessionId(null);
                        showSuccess(t('workyWhatsAppSystem.disconnected'));
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  {t('workyWhatsAppSystem.disconnect')}
                </Button>
                <Button
                  type='button'
                  size='sm'
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void reconnectAdminWorkyWhatsAppSystemBot(sessionId)
                      .then((updated) => {
                        setIntegration(updated);
                        if (updated.status === 'PAIRING' && updated.sessionId) {
                          setSessionId(updated.sessionId);
                          return getAdminWorkyWhatsAppSystemBotPairing(updated.sessionId).then(
                            applyPairingPayload,
                          );
                        }
                        return undefined;
                      })
                      .catch((err) =>
                        showWarning(t('workyWhatsAppSystem.reconnectFailed'), {
                          description: resolveWhatsAppApiError(err, networkErrorLabel),
                        }),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  {t('workyWhatsAppSystem.reconnect')}
                </Button>
              </>
            ) : null}
          </div>
          </section>

          <p className='text-xs text-muted-foreground'>
            <Link to='/admin/worky-governance' className='underline'>
              {t('workyWhatsAppSystem.governanceLink')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
