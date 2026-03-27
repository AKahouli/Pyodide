/**
 * Register Modal
 */

import * as React from 'react';
import { memo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2, AlertCircle, CheckCircle2, Mail } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '../../useAuth';
import { useModuleTranslation } from '@/modules/localization';
import type { ApiError } from '@/lib/api';
import { useAuthModalStore } from '../../store';

const createRegisterSchema = (passwordMismatchMessage: string) =>
  z
    .object({
      email: z.string().email(),
      password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: passwordMismatchMessage,
      path: ['confirmPassword'],
    });

type RegisterFormValues = z.infer<ReturnType<typeof createRegisterSchema>>;

type RegisterModalProps = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToLogin: () => void;
}>;

export const RegisterModal = memo(function RegisterModal({ open, onOpenChange, onSwitchToLogin }: RegisterModalProps) {
  const { register } = useAuth();
  const { t } = useModuleTranslation('auth');
  const registerSchema = React.useMemo(() => createRegisterSchema(t('register.error.passwordMismatch')), [t]);
  const registerSuccess = useAuthModalStore((state) => state.registerSuccess);
  const setRegisterSuccess = useAuthModalStore((state) => state.setRegisterSuccess);
  const registeredEmail = useAuthModalStore((state) => state.registeredEmail);
  const setRegisteredEmail = useAuthModalStore((state) => state.setRegisteredEmail);
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = async (data: RegisterFormValues) => {
    setError(null);
    setRegisterSuccess(false);
    setIsSubmitting(true);
    try {
      await register({ email: data.email, password: data.password });
      setRegisteredEmail(data.email);
      setRegisterSuccess(true);
      form.reset();
    } catch (err) {
      // Handle API error format
      const apiError = err as ApiError;

      if (apiError.code === 'ERR_1101') {
        setError(t('register.error.emailExists'));
      } else if (apiError.details && apiError.details.length > 0) {
        setError(apiError.details.map((d) => d.message).join('. '));
      } else if (apiError.message) {
        setError(apiError.message);
      } else {
        setError(t('register.error.failed'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSwitchToLogin = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      form.reset();
      setError(null);
      setRegisterSuccess(false);
      onSwitchToLogin();
    },
    [form, onSwitchToLogin],
  );

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        // Reset state when closing
        setError(null);
        setRegisterSuccess(false);
        form.reset();
      }
      onOpenChange(isOpen);
    },
    [form, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className='sm:max-w-106.25'>
        {registerSuccess ? (
          // Success state - show verification email sent message
          <>
            <DialogHeader className='text-center'>
              <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10'>
                <Mail className='h-6 w-6 text-green-500' />
              </div>
              <DialogTitle className='text-2xl font-bold text-center mb-8'>{t('register.success.title')}</DialogTitle>
              <DialogDescription className='text-center'>
                {t('register.success.description')} <span className='font-medium text-foreground'>{registeredEmail}</span>
              </DialogDescription>
            </DialogHeader>

            <div className='space-y-4'>
              <Alert className='bg-muted'>
                <CheckCircle2 className='h-4 w-4 text-green-500' />
                <AlertDescription>{t('register.success.message')}</AlertDescription>
              </Alert>

              <p className='text-center text-sm text-muted-foreground'>
                {t('register.success.resend')}{' '}
                <button type='button' onClick={() => setRegisterSuccess(false)} className='font-medium text-primary underline-offset-4 hover:underline'>
                  {t('register.success.tryAgain')}
                </button>
              </p>

              <Button variant='outline' className='w-full' onClick={() => handleClose(false)}>
                {t('register.success.close')}
              </Button>
            </div>
          </>
        ) : (
          // Registration form
          <>
            <DialogHeader>
              <DialogTitle className='text-2xl font-bold'>{t('register.title')}</DialogTitle>
              <DialogDescription>{t('register.description')}</DialogDescription>
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
                      <FormLabel>{t('register.email.label')}</FormLabel>
                      <FormControl>
                        <Input type='email' placeholder={t('register.email.placeholder')} autoComplete='email' disabled={isSubmitting} {...field} />
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
                      <FormLabel>{t('register.password.label')}</FormLabel>
                      <FormControl>
                        <Input type='password' placeholder={t('register.password.placeholder')} autoComplete='new-password' disabled={isSubmitting} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='confirmPassword'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('register.confirmPassword.label')}</FormLabel>
                      <FormControl>
                        <Input type='password' placeholder={t('register.confirmPassword.placeholder')} autoComplete='new-password' disabled={isSubmitting} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type='submit' className='w-full' disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      {t('register.submitting')}
                    </>
                  ) : (
                    t('register.submit')
                  )}
                </Button>

                <p className='text-center text-sm text-muted-foreground'>
                  {t('register.haveAccount')}{' '}
                  <button type='button' onClick={handleSwitchToLogin} className='font-medium text-primary underline-offset-4 hover:underline'>
                    {t('register.signIn')}
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

RegisterModal.displayName = 'RegisterModal';
