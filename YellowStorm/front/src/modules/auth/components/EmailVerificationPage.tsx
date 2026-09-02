/**
 * Email Verification Page
 * Handles magic link verification from email
 */

import * as React from 'react';
import { useSearchParams, useNavigate, NavLink } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AppBrandLogo } from '@/components/AppBrandLogo';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import { useModuleTranslation } from '@/modules/localization';
import type { TranslationParams } from '@/modules/localization';
import { useAuth } from '../useAuth';
import { resendVerificationByToken } from '../api';
import { getErrorCode, getErrorMessage } from '../utils/errorHelpers';
import { StatusSection } from './StatusSection';

const REDIRECT_DELAY = 30;

// ERR_1115 = email already verified — no point showing resend button
const ALREADY_VERIFIED_CODE = 'ERR_1115';

type VerificationStatus = 'verifying' | 'success' | 'error' | 'no-token';

export function EmailVerificationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { verifyEmail } = useAuth();
  const { t } = useModuleTranslation('auth');
  const translateAny = React.useCallback((key: string, params?: TranslationParams) => (t as unknown as (key: string, params?: TranslationParams) => string)(key, params), [t]);

  const [status, setStatus] = React.useState<VerificationStatus>('verifying');
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const [resendStatus, setResendStatus] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [countdown, setCountdown] = React.useState(REDIRECT_DELAY);

  const token = searchParams.get('token');
  const hasVerifiedRef = React.useRef(false);

  // Verification effect
  React.useEffect(() => {
    if (hasVerifiedRef.current) return;

    if (!token) {
      setStatus('no-token');
      return;
    }

    // Client-side format check — avoid unnecessary network round-trip
    if (token.length !== 64 || !/^[a-f0-9]+$/i.test(token)) {
      setStatus('error');
      setErrorMessage(t('verification.error.description'));
      return;
    }

    hasVerifiedRef.current = true;

    const verify = async () => {
      try {
        await verifyEmail(token);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setErrorCode(getErrorCode(err));
        setErrorMessage(
          getErrorMessage(err, translateAny, {
            translationPrefix: 'verification.error',
            fallbackKey: 'verification.defaultError',
          }),
        );
      }
    };

    verify();
  }, [token, verifyEmail, t, translateAny]);

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

  const handleResendEmail = async () => {
    if (!token) return;
    setResendStatus('sending');
    try {
      await resendVerificationByToken(token);
      setResendStatus('sent');
    } catch {
      setResendStatus('error');
    }
  };

  const handleGoToLogin = () => navigate('/');

  return (
    <div className='relative min-h-screen w-full overflow-hidden'>
      <StarsBackground shootingStars={false} />

      {/* Header */}
      <div className='absolute top-6 left-6 z-20'>
        <NavLink to='/' className='flex items-center'>
          <AppBrandLogo className='h-12 w-56' />
        </NavLink>
      </div>

      {/* Main content */}
      <main className='relative z-10 flex min-h-screen flex-col items-center justify-center px-6'>
        <Card className='w-full max-w-md bg-neutral border-neutral-800'>
          {status === 'verifying' && <StatusSection icon={<Loader2 className='h-12 w-12 animate-spin text-primary' />} title={t('verification.title')} description={t('verification.description')} />}

          {status === 'success' && (
            <StatusSection icon={<CheckCircle2 className='h-12 w-12 text-green-500' />} title={t('verification.success.title')} description={t('verification.success.description')}>
              <CardContent className='space-y-4'>
                <p className='text-sm text-neutral-400 text-center'>{t('verification.success.redirect', { seconds: countdown })}</p>
                <Button onClick={handleGoToLogin} className='w-full' size='lg'>
                  {t('verification.success.backToLogin')}
                </Button>
              </CardContent>
            </StatusSection>
          )}

          {status === 'error' && (
            <StatusSection
              icon={errorCode === ALREADY_VERIFIED_CODE ? <CheckCircle2 className='h-12 w-12 text-green-500' /> : <XCircle className='h-12 w-12 text-red-500' />}
              title={errorCode === ALREADY_VERIFIED_CODE ? t('verification.success.title') : t('verification.error.title')}
              description={errorMessage || t('verification.error.description')}
            >
              <CardContent className='space-y-4'>
                {errorCode !== ALREADY_VERIFIED_CODE && token && (
                  <>
                    <Button onClick={handleResendEmail} disabled={resendStatus === 'sending' || resendStatus === 'sent'} className='w-full' size='lg'>
                      {resendStatus === 'sending' && (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          {t('verification.error.sending')}
                        </>
                      )}
                      {resendStatus === 'sent' && (
                        <>
                          <CheckCircle2 className='mr-2 h-4 w-4' />
                          {t('verification.error.sent')}
                        </>
                      )}
                      {(resendStatus === 'idle' || resendStatus === 'error') && (
                        <>
                          <Mail className='mr-2 h-4 w-4' />
                          {t('verification.error.resend')}
                        </>
                      )}
                    </Button>
                    {resendStatus === 'error' && <p className='text-sm text-red-400 text-center'>{t('verification.error.failed')}</p>}
                  </>
                )}
                <Button onClick={handleGoToLogin} variant={errorCode === ALREADY_VERIFIED_CODE ? 'default' : 'outline'} className={errorCode === ALREADY_VERIFIED_CODE ? 'w-full' : 'w-full border-neutral-700 text-neutral-300 hover:bg-neutral-800'} size='lg'>
                  {t('verification.error.backToLogin')}
                </Button>
              </CardContent>
            </StatusSection>
          )}

          {status === 'no-token' && (
            <StatusSection icon={<Mail className='h-12 w-12 text-neutral-400' />} title={t('verification.noToken.title')} description={t('verification.noToken.description')}>
              <CardContent>
                <Button onClick={handleGoToLogin} className='w-full' size='lg'>
                  {t('verification.noToken.submit')}
                </Button>
              </CardContent>
            </StatusSection>
          )}
        </Card>
      </main>
    </div>
  );
}
