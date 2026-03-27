/**
 * Forgot Password Modal
 */

import * as React from 'react';
import { memo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2, AlertCircle, Mail } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useModuleTranslation } from '@/modules/localization';
import { forgotPassword } from '../../api';
import type { ApiError } from '@/lib/api';

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

interface ForgotPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBackToLogin: () => void;
}

export const ForgotPasswordModal = memo(function ForgotPasswordModal({ open, onOpenChange, onBackToLogin }: ForgotPasswordModalProps) {
  const { t } = useModuleTranslation('auth');
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [submittedEmail, setSubmittedEmail] = React.useState('');

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  });

  const onSubmit = async (data: ForgotPasswordFormValues) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await forgotPassword(data.email);
      setSubmittedEmail(data.email);
      setSuccess(true);
      form.reset();
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.code === 'ERR_1007') {
        setError(t('forgotPassword.error.rateLimit'));
      } else {
        setError(t('forgotPassword.error.failed'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackToLogin = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    form.reset();
    setError(null);
    setSuccess(false);
    onBackToLogin();
  }, [form, onBackToLogin]);

  const handleClose = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      setError(null);
      setSuccess(false);
      form.reset();
    }
    onOpenChange(isOpen);
  }, [form, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className='sm:max-w-106.25'>
        {success ? (
          <>
            <DialogHeader className='text-center'>
              <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10'>
                <Mail className='h-6 w-6 text-primary' />
              </div>
              <DialogTitle className='text-2xl font-bold'>{t('forgotPassword.success.title')}</DialogTitle>
              <DialogDescription className='text-center'>
                {t('forgotPassword.success.description')} <span className='font-medium text-foreground'>{submittedEmail}</span>
              </DialogDescription>
            </DialogHeader>

            <div className='space-y-4'>
              <p className='text-center text-sm text-muted-foreground'>{t('forgotPassword.success.hint')}</p>

              <button type='button' onClick={handleBackToLogin} className='block w-full text-center text-sm font-medium text-primary underline-offset-4 hover:underline'>
                {t('forgotPassword.backToLogin')}
              </button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className='text-2xl font-bold'>{t('forgotPassword.title')}</DialogTitle>
              <DialogDescription>{t('forgotPassword.description')}</DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
                {error && (
                  <Alert variant='destructive'>
                    <AlertCircle className='h-4 w-4' />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <FormField
                  control={form.control}
                  name='email'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('forgotPassword.email.label')}</FormLabel>
                      <FormControl>
                        <Input type='email' placeholder={t('forgotPassword.email.placeholder')} autoComplete='email' disabled={isSubmitting} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type='submit' className='w-full' disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      {t('forgotPassword.submitting')}
                    </>
                  ) : (
                    t('forgotPassword.submit')
                  )}
                </Button>

                <p className='text-center text-sm text-muted-foreground'>
                  <button type='button' onClick={handleBackToLogin} className='font-medium text-primary underline-offset-4 hover:underline'>
                    {t('forgotPassword.backToLogin')}
                  </button>
                </p>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});

ForgotPasswordModal.displayName = 'ForgotPasswordModal';
