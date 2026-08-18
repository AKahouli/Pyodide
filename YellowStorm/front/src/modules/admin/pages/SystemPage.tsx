/**
 * SystemPage - System settings and maintenance mode
 */

import { useEffect, useState } from 'react';
import {
  Settings,
  Loader2,
  AlertCircle,
  RefreshCw,
  Power,
  Clock,
  User,
  AlertTriangle,
  CalendarIcon,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { getMaintenanceStatus, setMaintenanceMode, getRegistrationStatus, setRegistrationStatus } from '../api';
import type { MaintenanceStatus, RegistrationStatus } from '../types';
import { CorsSettingsCard } from '../components/CorsSettingsCard';
import { FeatureVisibilityCard } from '../components/FeatureVisibilityCard';
import { CopilotAssistantCard } from '../components/CopilotAssistantCard';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

type AdminTranslate = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;

// Format date for display
function formatDate(dateString?: string): string {
  if (!dateString) return 'Not set';
  return new Date(dateString).toLocaleString();
}

// Generate hour options
const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const minutes = ['00', '15', '30', '45'];

export function SystemPage() {
  const { t } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedHour, setSelectedHour] = useState('12');
  const [selectedMinute, setSelectedMinute] = useState('00');

  // Confirmation dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState(false);

  // Registration state
  const [regStatus, setRegStatus] = useState<RegistrationStatus | null>(null);
  const [regEnabled, setRegEnabled] = useState(true);
  const [regSaving, setRegSaving] = useState(false);
  const [regLoading, setRegLoading] = useState(true);
  const [showRegConfirmDialog, setShowRegConfirmDialog] = useState(false);
  const [pendingRegEnabled, setPendingRegEnabled] = useState(false);

  const fetchRegistrationStatus = async () => {
    setRegLoading(true);
    try {
      const data = await getRegistrationStatus();
      setRegStatus(data);
      setRegEnabled(data.enabled);
    } catch (err) {
      // Fail-open: default to enabled if fetch fails
      setRegEnabled(true);
    } finally {
      setRegLoading(false);
    }
  };

  const handleRegToggleChange = (checked: boolean) => {
    setPendingRegEnabled(checked);
    setShowRegConfirmDialog(true);
  };

  const handleRegConfirmToggle = async () => {
    setShowRegConfirmDialog(false);
    setRegSaving(true);
    try {
      const data = await setRegistrationStatus({ enabled: pendingRegEnabled });
      setRegStatus(data);
      setRegEnabled(data.enabled);
      if (data.enabled) {
        toast.success(t('system.registration.toasts.enabled.title'), {
          description: t('system.registration.toasts.enabled.description'),
        });
      } else {
        toast.success(t('system.registration.toasts.disabled.title'), {
          description: t('system.registration.toasts.disabled.description'),
        });
      }
    } catch (err) {
      toast.error(t('system.registration.toasts.error'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    } finally {
      setRegSaving(false);
    }
  };

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getMaintenanceStatus();
      setStatus(data);
      setEnabled(data.enabled);
      setMessage(data.message || '');

      // Parse estimated end time
      if (data.estimatedEndAt) {
        const date = new Date(data.estimatedEndAt);
        setSelectedDate(date);
        setSelectedHour(date.getHours().toString().padStart(2, '0'));
        setSelectedMinute(
          (Math.floor(date.getMinutes() / 15) * 15).toString().padStart(2, '0')
        );
      } else {
        setSelectedDate(undefined);
        setSelectedHour('12');
        setSelectedMinute('00');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('system.maintenance.errors.load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchRegistrationStatus();
  }, []);

  // Combine date and time into ISO string
  const getEstimatedEndAt = (): string | undefined => {
    if (!selectedDate) return undefined;
    const date = new Date(selectedDate);
    date.setHours(parseInt(selectedHour, 10));
    date.setMinutes(parseInt(selectedMinute, 10));
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date.toISOString();
  };

  const handleToggleChange = (checked: boolean) => {
    setPendingEnabled(checked);
    setShowConfirmDialog(true);
  };

  const handleConfirmToggle = async () => {
    setShowConfirmDialog(false);
    await handleSave(pendingEnabled);
  };

  const handleSave = async (newEnabled?: boolean) => {
    setSaving(true);

    try {
      const enabledValue = newEnabled !== undefined ? newEnabled : enabled;
      const data = await setMaintenanceMode({
        enabled: enabledValue,
        message: message || undefined,
        estimatedEndAt: getEstimatedEndAt(),
      });

      setStatus(data);
      setEnabled(data.enabled);

      if (data.enabled) {
        toast.success(t('system.maintenance.toasts.enabled.title'), {
          description: t('system.maintenance.toasts.enabled.description'),
        });
      } else {
        toast.success(t('system.maintenance.toasts.disabled.title'), {
          description: t('system.maintenance.toasts.disabled.description'),
        });
      }
    } catch (err) {
      toast.error(t('system.maintenance.toasts.error'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSettings = async () => {
    if (!enabled) {
      toast.info(t('system.maintenance.toasts.enableFirst'));
      return;
    }
    await handleSave();
  };

  const setQuickMaintenance = (durationMinutes: number, customMessage: string) => {
    const endDate = new Date(Date.now() + durationMinutes * 60 * 1000);
    setSelectedDate(endDate);
    setSelectedHour(endDate.getHours().toString().padStart(2, '0'));
    setSelectedMinute(
      (Math.floor(endDate.getMinutes() / 15) * 15).toString().padStart(2, '0')
    );
    setMessage(customMessage);
    toast.info(t('system.maintenance.toasts.settingsApplied.title'), {
      description: t('system.maintenance.toasts.settingsApplied.description'),
    });
  };

  const clearSettings = () => {
    setMessage('');
    setSelectedDate(undefined);
    setSelectedHour('12');
    setSelectedMinute('00');
    toast.info(t('system.maintenance.toasts.settingsCleared.title'), {
      description: t('system.maintenance.toasts.settingsCleared.description'),
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={fetchStatus} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          {tCommon('actionRetry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('system.title')}</h1>
          <p className="text-muted-foreground">{t('system.description')}</p>
        </div>
        <Button onClick={() => { fetchStatus(); fetchRegistrationStatus(); }} variant="outline" size="icon" aria-label={t('system.actions.refresh')}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Current Status Alert */}
      {status?.enabled && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('system.maintenance.alert.title')}</AlertTitle>
          <AlertDescription>
            {t('system.maintenance.alert.description')}
          </AlertDescription>
        </Alert>
      )}

      <FeatureVisibilityCard />

      <CopilotAssistantCard />

      {/* Maintenance Mode Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>{t('system.maintenance.card.title')}</CardTitle>
                <CardDescription>
                  {t('system.maintenance.card.description')}
                </CardDescription>
              </div>
            </div>
            <Badge variant={status?.enabled ? 'destructive' : 'secondary'}>
              {status?.enabled ? t('system.status.active') : t('system.status.inactive')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Toggle Switch */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="maintenance-toggle" className="text-base font-medium">
                {t('system.maintenance.toggle.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('system.maintenance.toggle.helper')}
              </p>
            </div>
            <Switch
              id="maintenance-toggle"
              checked={enabled}
              onCheckedChange={handleToggleChange}
              disabled={saving}
            />
          </div>

          {/* Current Status Info */}
          {status?.enabled && status.startedAt && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center gap-3 rounded-lg border p-4">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{t('system.maintenance.info.startedAt')}</p>
                  <p className="text-sm text-muted-foreground">{formatDate(status.startedAt)}</p>
                </div>
              </div>
              {status.startedBy && (
                <div className="flex items-center gap-3 rounded-lg border p-4">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{t('system.maintenance.info.startedBy')}</p>
                    <p className="text-sm text-muted-foreground">{status.startedBy}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Settings Form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="maintenance-message">{t('system.maintenance.message.label')}</Label>
              <Textarea
                id="maintenance-message"
                placeholder={t('system.maintenance.message.placeholder')}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={500}
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                {t('system.maintenance.message.helper')}
              </p>
            </div>

            {/* Date and Time Picker */}
            <div className="space-y-2">
              <Label>{t('system.maintenance.endTime.label')}</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                {/* Date Picker */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full sm:w-[240px] justify-start text-left font-normal',
                        !selectedDate && 'text-muted-foreground'
                      )}
                      disabled={saving}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selectedDate ? format(selectedDate, 'PPP') : t('system.maintenance.endTime.pickDate')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      disabled={(date) => date < new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                {/* Time Selectors */}
                <div className="flex gap-2">
                  <Select
                    value={selectedHour}
                    onValueChange={setSelectedHour}
                    disabled={saving || !selectedDate}
                  >
                    <SelectTrigger className="w-[80px]">
                      <SelectValue placeholder={t('system.maintenance.endTime.hour')} />
                    </SelectTrigger>
                    <SelectContent>
                      {hours.map((hour) => (
                        <SelectItem key={hour} value={hour}>
                          {hour}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="flex items-center text-muted-foreground">:</span>
                  <Select
                    value={selectedMinute}
                    onValueChange={setSelectedMinute}
                    disabled={saving || !selectedDate}
                  >
                    <SelectTrigger className="w-[80px]">
                      <SelectValue placeholder={t('system.maintenance.endTime.minute')} />
                    </SelectTrigger>
                    <SelectContent>
                      {minutes.map((minute) => (
                        <SelectItem key={minute} value={minute}>
                          {minute}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Clear date button */}
                {selectedDate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedDate(undefined)}
                    disabled={saving}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('system.maintenance.endTime.helper')}
              </p>
            </div>

            {enabled && (
              <Button onClick={handleUpdateSettings} disabled={saving} className="w-full sm:w-auto">
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('system.maintenance.actions.updating')}
                  </>
                ) : (
                  t('system.maintenance.actions.update')
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>{t('system.maintenance.quickActions.title')}</CardTitle>
          <CardDescription>{t('system.maintenance.quickActions.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Button
              variant="outline"
              className="h-auto flex-col items-start p-4 gap-2"
              onClick={() =>
                setQuickMaintenance(
                  30,
                  t('system.maintenance.quickActions.quick30min.message')
                )
              }
            >
              <div className="flex items-center gap-2">
                <Power className="h-4 w-4" />
                <span className="font-medium">{t('system.maintenance.quickActions.quick30min.title')}</span>
              </div>
              <span className="text-xs text-muted-foreground text-left">
                {t('system.maintenance.quickActions.quick30min.description')}
              </span>
            </Button>

            <Button
              variant="outline"
              className="h-auto flex-col items-start p-4 gap-2"
              onClick={() =>
                setQuickMaintenance(
                  120,
                  t('system.maintenance.quickActions.extended2hrs.message')
                )
              }
            >
              <div className="flex items-center gap-2">
                <Power className="h-4 w-4" />
                <span className="font-medium">{t('system.maintenance.quickActions.extended2hrs.title')}</span>
              </div>
              <span className="text-xs text-muted-foreground text-left">
                {t('system.maintenance.quickActions.extended2hrs.description')}
              </span>
            </Button>

            <Button
              variant="outline"
              className="h-auto flex-col items-start p-4 gap-2"
              onClick={clearSettings}
            >
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                <span className="font-medium">{t('system.maintenance.quickActions.clear.title')}</span>
              </div>
              <span className="text-xs text-muted-foreground text-left">
                {t('system.maintenance.quickActions.clear.description')}
              </span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Registration Settings Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>{t('system.registration.card.title')}</CardTitle>
                <CardDescription>
                  {t('system.registration.card.description')}
                </CardDescription>
              </div>
            </div>
            {regLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Badge variant={regEnabled ? 'default' : 'destructive'}>
                {regEnabled ? t('system.registration.status.open') : t('system.registration.status.closed')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Toggle Switch */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="registration-toggle" className="text-base font-medium">
                {t('system.registration.toggle.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('system.registration.toggle.helper')}
              </p>
            </div>
            <Switch
              id="registration-toggle"
              checked={regEnabled}
              onCheckedChange={handleRegToggleChange}
              disabled={regSaving || regLoading}
            />
          </div>

          {/* Disabled Info */}
          {regStatus && !regStatus.enabled && regStatus.disabledAt && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center gap-3 rounded-lg border p-4">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{t('system.registration.info.disabledAt')}</p>
                  <p className="text-sm text-muted-foreground">{formatDate(regStatus.disabledAt)}</p>
                </div>
              </div>
              {regStatus.disabledBy && (
                <div className="flex items-center gap-3 rounded-lg border p-4">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{t('system.registration.info.disabledBy')}</p>
                    <p className="text-sm text-muted-foreground">{regStatus.disabledBy}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CorsSettingsCard />

      {/* Maintenance Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingEnabled ? t('system.maintenance.dialog.enableTitle') : t('system.maintenance.dialog.disableTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingEnabled
                ? t('system.maintenance.dialog.enableDescription')
                : t('system.maintenance.dialog.disableDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actionCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmToggle}
              className={pendingEnabled ? 'bg-destructive hover:bg-destructive/90' : ''}
            >
              {pendingEnabled ? t('system.maintenance.dialog.enableAction') : t('system.maintenance.dialog.disableAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Registration Confirmation Dialog */}
      <AlertDialog open={showRegConfirmDialog} onOpenChange={setShowRegConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRegEnabled ? t('system.registration.dialog.enableTitle') : t('system.registration.dialog.disableTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRegEnabled
                ? t('system.registration.dialog.enableDescription')
                : t('system.registration.dialog.disableDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actionCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRegConfirmToggle}
              className={!pendingRegEnabled ? 'bg-destructive hover:bg-destructive/90' : ''}
            >
              {pendingRegEnabled ? t('system.registration.dialog.enableAction') : t('system.registration.dialog.disableAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
