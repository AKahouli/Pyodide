import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wrench, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getMaintenanceInfo, clearMaintenanceInfo, type MaintenanceInfo } from '@/lib/api/client';
import { API_CONFIG, API_ENDPOINTS } from '@/lib/api/config';
import { useAuth } from '@/modules/auth';
import { useModuleTranslation } from '@/modules/localization';

export default function MaintenancePage() {
  const navigate = useNavigate();
  const [maintenance, setMaintenance] = useState<MaintenanceInfo | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const { logout } = useAuth();
  const { t } = useModuleTranslation('common');
  useEffect(() => {
    const info = getMaintenanceInfo();
    if (info) {
      setMaintenance(info);
    }
  }, []);

  // Countdown timer for estimated end time.

  useEffect(() => {
    if (!maintenance?.estimatedEndAt) return;
    const updateCountdown = () => {
      const end = new Date(maintenance.estimatedEndAt!).getTime();
      const now = Date.now();
      const diff = end - now;

      if (diff <= 0) {
        setCountdown(t('maintenance.countdown.anyMoment', { defaultValue: 'Any moment now' }));
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setCountdown(
          t('maintenance.countdown.hours', {
            hours,
            minutes,
            seconds,
            defaultValue: '{{hours}}h {{minutes}}m {{seconds}}s',
          }),
        );
      } else if (minutes > 0) {
        setCountdown(t('maintenance.countdown.minutes', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' }));
      } else {
        setCountdown(t('maintenance.countdown.seconds', { seconds, defaultValue: '{{seconds}}s' }));
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [maintenance?.estimatedEndAt, t]);

  // Auto-check every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      checkStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    try {
      const response = await fetch(`${API_CONFIG.baseURL}${API_ENDPOINTS.system.maintenance}`);
      const data = await response.json();
      if (data.data.enabled === false) {
        // Maintenance is over, redirect back
        clearMaintenanceInfo();
        navigate('/', { replace: true });
      } else {
        setMaintenance(data);
      }
    } catch {
      // If we can't reach the server, maintenance might still be on
    } finally {
    }
  };

  const handleBackToLogin = () => {
    logout();
    clearMaintenanceInfo();
    navigate('/', { replace: true });
  };

  return (
    <div className='min-h-screen bg-background text-foreground flex items-center justify-center p-4 z-999'>
      <div className='max-w-md w-full text-center space-y-6'>
        {/* Icon */}
        <div className='flex justify-center'>
          <div className='p-4 rounded-full bg-amber-500/10 text-amber-500'>
            <Wrench className='h-12 w-12' />
          </div>
        </div>

        {/* Title */}
        <div className='space-y-2'>
          <h1 className='text-3xl font-bold'>{t('maintenance.title', { defaultValue: 'We’re doing a little maintenance' })}</h1>
          <p className='text-muted-foreground'>
            {t('maintenance.description', {
              defaultValue: 'The app is temporarily unavailable while we finish some upgrades. Thank you for your patience.',
            })}
          </p>
        </div>

        {/* Message from admin */}
        {maintenance?.message && (
          <div className='bg-muted/50 border rounded-lg p-4 text-left'>
            <p className='text-sm'>{maintenance.message}</p>
          </div>
        )}

        {/* Estimated time */}
        {maintenance?.estimatedEndAt && countdown && (
          <div className='flex items-center justify-center gap-2 text-muted-foreground'>
            <Clock className='h-4 w-4' />
            <span className='text-sm'>
              {t('maintenance.countdown.label', { defaultValue: 'Estimated time remaining:' })} <span className='font-mono font-medium text-foreground'>{countdown}</span>
            </span>
          </div>
        )}

        {/* Actions */}
        <div className='flex flex-col gap-3 pt-4'>
          <Button variant='outline' onClick={handleBackToLogin} className='w-full'>
            {t('maintenance.backToLogin', { defaultValue: 'Back to login' })}
          </Button>
        </div>

        {/* Auto-refresh notice */}
        <p className='text-xs text-muted-foreground'>
          {t('maintenance.autoRefreshNotice', {
            defaultValue: 'This page checks automatically and will reopen when maintenance ends.!',
          })}
        </p>
      </div>
    </div>
  );
}
