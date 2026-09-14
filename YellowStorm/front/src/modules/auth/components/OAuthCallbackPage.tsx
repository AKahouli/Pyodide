import { useEffect, useRef, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '../useAuth';
import { exchangeOAuthToken } from '../api';
import { AUTH_STORAGE_KEYS } from '@/lib/api/config';
import { scheduleProactiveRefresh } from '@/lib/api/client';

export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const { t, ready } = useModuleTranslation('auth');
  const [status, setStatus] = useState<'loading' | 'success' | 'link_required' | 'linked' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  // Guard against StrictMode double-mount consuming the single-use token twice
  const exchangeStartedRef = useRef(false);

  // Resolve error message: try specific key, fall back to default
  const errorDisplayMessage = useMemo(() => {
    if (!errorMessage) return t('oauthCallback.error.default');
    const key = `oauthCallback.error.${errorMessage}`;
    const translated = t(key as Parameters<typeof t>[0]);
    // If t() returns the key itself, the translation doesn't exist — use default
    if (translated === key) return t('oauthCallback.error.default');
    return translated;
  }, [errorMessage, t]);

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');
    const linkRequired = searchParams.get('link_required');
    const linked = searchParams.get('linked');
    const email = searchParams.get('email');

    if (linked === 'true') {
      setStatus('linked');
      return;
    }

    if (linkRequired === 'true') {
      setStatus('link_required');
      setMaskedEmail(email || '');
      return;
    }

    if (error) {
      setStatus('error');
      setErrorMessage(error);
      return;
    }

    if (token) {
      if (exchangeStartedRef.current) return;
      exchangeStartedRef.current = true;
      handleTokenExchange(token);
      return;
    }

    setStatus('error');
    setErrorMessage('missing_params');
  }, [searchParams]);

  async function handleTokenExchange(token: string) {
    try {
      const response = await exchangeOAuthToken(token);
      // Store access token
      localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, response.accessToken);
      scheduleProactiveRefresh(response.accessToken);
      if (response.user) {
        localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(response.user));
      }
      setStatus('success');
      // Refresh auth context and redirect
      await refreshUser();
      navigate('/', { replace: true });
    } catch {
      setStatus('error');
      setErrorMessage('exchange_failed');
    }
  }

  if (!ready) return null;

  return (
    <div className='flex min-h-screen items-center justify-center bg-neutral-950'>
      <div className='w-full max-w-md space-y-6 p-8 text-center'>
        {status === 'loading' && (
          <>
            <Loader2 className='mx-auto h-12 w-12 animate-spin text-primary' />
            <h2 className='text-xl font-semibold text-white'>{t('oauthCallback.loading')}</h2>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className='mx-auto h-12 w-12 text-green-500' />
            <h2 className='text-xl font-semibold text-white'>{t('oauthCallback.success')}</h2>
          </>
        )}

        {status === 'linked' && (
          <>
            <Link2 className='mx-auto h-12 w-12 text-green-500' />
            <h2 className='text-xl font-semibold text-white'>{t('oauthCallback.linked.title')}</h2>
            <p className='text-neutral-400'>{t('oauthCallback.linked.description')}</p>
            <Button onClick={() => navigate('/', { replace: true })} className='mt-4'>
              {t('oauthCallback.linked.continue')}
            </Button>
          </>
        )}

        {status === 'link_required' && (
          <>
            <AlertCircle className='mx-auto h-12 w-12 text-yellow-500' />
            <h2 className='text-xl font-semibold text-white'>{t('oauthCallback.linkRequired.title')}</h2>
            <p className='text-neutral-400'>
              {t('oauthCallback.linkRequired.description', { email: maskedEmail })}
            </p>
            <Button variant='outline' onClick={() => navigate('/', { replace: true })} className='mt-4'>
              {t('oauthCallback.linkRequired.backToLogin')}
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className='mx-auto h-12 w-12 text-red-500' />
            <h2 className='text-xl font-semibold text-white'>{t('oauthCallback.error.title')}</h2>
            <p className='text-neutral-400'>
              {errorDisplayMessage}
            </p>
            <Button variant='outline' onClick={() => navigate('/', { replace: true })} className='mt-4'>
              {t('oauthCallback.error.backToLogin')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
