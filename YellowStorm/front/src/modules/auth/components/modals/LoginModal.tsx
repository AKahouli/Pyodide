/**
 * Login Modal
 */

import * as React from 'react';
import { memo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '../../useAuth';
import { useModuleTranslation } from '@/modules/localization';
import type { ApiError } from '@/lib/api';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type LoginFormValues = z.infer<typeof loginSchema>;

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToRegister: () => void;
  onForgotPassword: () => void;
}

export const LoginModal = memo(function LoginModal({ open, onOpenChange, onSwitchToRegister, onForgotPassword }: LoginModalProps) {
  const navigate = useNavigate();
  const { login, registrationEnabled } = useAuth();
  const { t } = useModuleTranslation('auth');
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await login(data);
      onOpenChange(false);
      form.reset();

      // Navigate to root - RootGuard will handle redirect to profile completion if needed
      navigate('/');
    } catch (err) {
      // Handle API error format
      const apiError = err as ApiError;

      if (apiError.code === 'ERR_1104') {
        setError(t('login.error.notVerified'));
      } else if (apiError.code === 'ERR_1110') {
        setError(t('login.error.suspended'));
      } else if (apiError.code === 'ERR_1202') {
        setError(t('login.error.inactive'));
      } else if (apiError.details && apiError.details.length > 0) {
        setError(apiError.details.map((d) => d.message).join('. '));
      } else if (apiError.message) {
        setError(apiError.message);
      } else {
        setError(t('login.error.failed'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSwitchToRegister = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      form.reset();
      setError(null);
      onSwitchToRegister();
    },
    [form, onSwitchToRegister],
  );

  const handleForgotPassword = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      form.reset();
      setError(null);
      onForgotPassword();
    },
    [form, onForgotPassword],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-106.25'>
        <DialogHeader>
          <DialogTitle className='text-2xl font-bold'>{t('login.title')}</DialogTitle>
          <DialogDescription>{t('login.description')}</DialogDescription>
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
                  <FormLabel>{t('login.email.label')}</FormLabel>
                  <FormControl>
                    <Input type='email' placeholder={t('login.email.placeholder')} autoComplete='email' disabled={isSubmitting} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('login.password.label')}</FormLabel>
                  <FormControl>
                    <Input type='password' placeholder={t('login.password.placeholder')} autoComplete='current-password' disabled={isSubmitting} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='flex justify-end'>
              <button type='button' onClick={handleForgotPassword} className='text-sm font-medium text-primary underline-offset-4 hover:underline'>
                {t('login.forgotPassword')}
              </button>
            </div>

            <Button type='submit' className='w-full' disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  {t('login.submitting')}
                </>
              ) : (
                t('login.submit')
              )}
            </Button>

            {registrationEnabled && (
              <p className='text-center text-sm text-muted-foreground'>
                {t('login.noAccount')}{' '}
                <button type='button' onClick={handleSwitchToRegister} className='font-medium text-primary underline-offset-4 hover:underline'>
                  {t('login.createOne')}
                </button>
              </p>
            )}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
});

LoginModal.displayName = 'LoginModal';
