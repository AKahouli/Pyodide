/**
 * Reset Password Page
 * Handles password reset from email link
 */

import * as React from 'react';
import { useSearchParams, useNavigate, NavLink } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { CheckCircle2, XCircle, Loader2, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Icons, AppLogo } from '@/components/icons';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import { useModuleTranslation } from '@/modules/localization';
import type { TranslationParams } from '@/modules/localization';
import { resetPassword } from '../api';
import { getErrorMessage } from '../utils/errorHelpers';
import { StatusSection } from './StatusSection';

const REDIRECT_DELAY = 10;

const resetPasswordSchema = z
  .object({
    password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'resetPassword.error.passwordMismatch',
    path: ['confirmPassword'],
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

type ResetStatus = 'form' | 'submitting' | 'success' | 'error' | 'no-token';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useModuleTranslation('auth');
  const translateAny = React.useCallback((key: string, params?: TranslationParams) => (t as unknown as (key: string, params?: TranslationParams) => string)(key, params), [t]);

  const [status, setStatus] = React.useState<ResetStatus>('form');
  const [errorMessage, setErrorMessage] = React.useState('');
  const [countdown, setCountdown] = React.useState(REDIRECT_DELAY);

  const token = searchParams.get('token');

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  // Validate token format on mount
  React.useEffect(() => {
    if (!token) {
      setStatus('no-token');
      return;
    }
    if (token.length !== 64 || !/^[a-f0-9]+$/i.test(token)) {
      setStatus('error');
      setErrorMessage(t('resetPassword.error.invalidToken'));
    }
  }, [token, t]);

  // Countdown + redirect on success
  React.useEffect(() => {
    if (status !== 'success') return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          navigate('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [status, navigate]);

  const onSubmit = async (data: ResetPasswordFormValues) => {
    if (!token) return;
    setStatus('submitting');
    try {
      await resetPassword(token, data.password);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        getErrorMessage(err, translateAny, {
          translationPrefix: 'resetPassword.error',
          fallbackKey: 'resetPassword.error.default',
        }),
      );
    }
  };

  const handleGoToLogin = () => navigate('/');

  return (
    <div className='relative min-h-screen w-full overflow-hidden'>
      <StarsBackground shootingStars={false} />

      {/* Header */}
      <div className='absolute top-6 left-6 z-20'>
        <NavLink to='/' className='flex items-center'>
          <AppLogo className='h-12 w-56' />
        </NavLink>
      </div>

      {/* Main content */}
      <main className='relative z-10 flex min-h-screen flex-col items-center justify-center px-6'>
        <Card className='w-full max-w-md bg-neutral border-neutral-800'>
          {(status === 'form' || status === 'submitting') && (
            <>
              <CardHeader className='text-center'>
                <CardTitle className='text-2xl text-white'>{t('resetPassword.title')}</CardTitle>
                <CardDescription className='text-neutral-400'>{t('resetPassword.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
                    <FormField
                      control={form.control}
                      name='password'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className='text-neutral-200'>{t('resetPassword.password.label')}</FormLabel>
                          <FormControl>
                            <Input type='password' placeholder={t('resetPassword.password.placeholder')} autoComplete='new-password' disabled={status === 'submitting'} {...field} />
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
                          <FormLabel className='text-neutral-200'>{t('resetPassword.confirmPassword.label')}</FormLabel>
                          <FormControl>
                            <Input type='password' placeholder={t('resetPassword.confirmPassword.placeholder')} autoComplete='new-password' disabled={status === 'submitting'} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <p className='text-xs text-neutral-500'>{t('resetPassword.requirements')}</p>

                    <Button type='submit' className='w-full' size='lg' disabled={status === 'submitting'}>
                      {status === 'submitting' ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          {t('resetPassword.submitting')}
                        </>
                      ) : (
                        t('resetPassword.submit')
                      )}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </>
          )}

          {status === 'success' && (
            <StatusSection icon={<CheckCircle2 className='h-12 w-12 text-green-500' />} title={t('resetPassword.success.title')} description={t('resetPassword.success.description')}>
              <CardContent className='space-y-4'>
                <p className='text-sm text-neutral-400 text-center'>{t('resetPassword.success.redirect', { seconds: countdown })}</p>
                <Button onClick={handleGoToLogin} className='w-full' size='lg'>
                  {t('resetPassword.success.backToLogin')}
                </Button>
              </CardContent>
            </StatusSection>
          )}

          {status === 'error' && (
            <StatusSection icon={<XCircle className='h-12 w-12 text-red-500' />} title={t('resetPassword.error.title')} description={errorMessage}>
              <CardContent className='space-y-4'>
                <Button onClick={handleGoToLogin} variant='outline' className='w-full border-neutral-700 text-neutral-300 hover:bg-neutral-800' size='lg'>
                  {t('resetPassword.error.backToLogin')}
                </Button>
              </CardContent>
            </StatusSection>
          )}

          {status === 'no-token' && (
            <StatusSection icon={<Mail className='h-12 w-12 text-neutral-400' />} title={t('resetPassword.noToken.title')} description={t('resetPassword.noToken.description')}>
              <CardContent>
                <Button onClick={handleGoToLogin} className='w-full' size='lg'>
                  {t('resetPassword.noToken.submit')}
                </Button>
              </CardContent>
            </StatusSection>
          )}
        </Card>
      </main>
    </div>
  );
}
