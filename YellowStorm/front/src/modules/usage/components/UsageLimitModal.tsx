/**
 * Usage Limit Modal
 * Displays when user has exceeded their plan's token limit
 */

import * as React from 'react';
import { useMemo, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUsage } from '../UsageContext';
/**
 * @deprecated Use UsageLimitBanner instead.
 */

export const UsageLimitModal = memo(function UsageLimitModal() {
  const navigate = useNavigate();
  const { status } = useUsage();
  const [isOpen, setIsOpen] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  // Show modal when limit is exceeded (but only once per session until dismissed)
  React.useEffect(() => {
    if (status?.isLimitExceeded && !dismissed) {
      setIsOpen(true);
    }
  }, [status?.isLimitExceeded, dismissed]);

  const handleDismiss = useCallback(() => {
    setIsOpen(false);
    setDismissed(true);
  }, []);

  const handleUpgrade = useCallback(() => {
    setIsOpen(false);
    navigate('/upgrade');
  }, [navigate]);

  // Calculate formatResetTime before early return - hooks must be called before any returns
  const resetTime = status ? new Date(status.resetsAt) : null;
  const now = new Date();
  const hoursRemaining = resetTime ? Math.max(0, Math.ceil((resetTime.getTime() - now.getTime()) / (1000 * 60 * 60))) : 0;
  const minutesRemaining = resetTime ? Math.max(0, Math.ceil((resetTime.getTime() - now.getTime()) / (1000 * 60)) % 60) : 0;

  const formatResetTime = useMemo(() => {
    if (hoursRemaining > 0) {
      return `${hoursRemaining}h ${minutesRemaining}m`;
    }
    return `${minutesRemaining} minutes`;
  }, [hoursRemaining, minutesRemaining]);

  if (!status) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 mb-4'>
            <AlertTriangle className='h-6 w-6 text-rose-600' />
          </div>
          <DialogTitle className='text-center text-xl'>Usage Limit Reached</DialogTitle>
          <DialogDescription className='text-center'>
            You've reached the token limit for your <span className='font-semibold text-foreground'>{status.plan.name}</span> plan.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-4'>
          {/* Usage Stats */}
          <div className='rounded-lg bg-muted p-4 space-y-3'>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>Tokens Used</span>
              <span className='font-medium'>
                {status.tokens.total.toLocaleString()} / {status.tokens.limit.toLocaleString()}
              </span>
            </div>
            <div className='h-2 rounded-full bg-muted-foreground/20 overflow-hidden'>
              <div className='h-full bg-rose-500 rounded-full' style={{ width: '100%' }} />
            </div>
          </div>

          {/* Reset Time */}
          <div className='flex items-center gap-3 rounded-lg border p-4'>
            <Clock className='h-5 w-5 text-muted-foreground' />
            <div className='flex-1'>
              <p className='text-sm font-medium'>Limit Resets In</p>
              <p className='text-2xl font-bold text-primary'>{formatResetTime}</p>
            </div>
          </div>

          {/* Upgrade CTA */}
          <div className='rounded-lg bg-linear-to-r from-rose-50 to-pink-50 dark:from-rose-950/30 dark:to-pink-950/30 border border-rose-200 dark:border-rose-800 p-4'>
            <div className='flex items-start gap-3'>
              <Zap className='h-5 w-5 text-rose-500 mt-0.5' />
              <div>
                <p className='font-medium text-rose-900 dark:text-rose-100'>Need more tokens?</p>
                <p className='text-sm text-rose-700 dark:text-rose-300 mt-1'>Upgrade your plan for higher limits and additional features.</p>
              </div>
            </div>
          </div>
        </div>

        <div className='flex flex-col-reverse sm:flex-row gap-2'>
          <Button variant='outline' onClick={handleDismiss} className='flex-1'>
            Maybe Later
          </Button>
          <Button onClick={handleUpgrade} className='flex-1 bg-rose-600 hover:bg-rose-700'>
            <Zap className='h-4 w-4 mr-2' />
            Upgrade Plan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});
