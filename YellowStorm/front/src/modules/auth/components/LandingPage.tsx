import * as React from 'react';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/config/app';
import { AuthModals } from './modals/AuthModals';
import { NavLink } from 'react-router-dom';
import { AppBrandLogo } from '@/components/AppBrandLogo';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '../useAuth';
import { AuthScrollShell } from './AuthScrollShell';
import { useAuthModalStore } from '../store';
import { getAuthProviders } from '../api';
import { ProviderIcon } from './ProviderIcon';
import { API_CONFIG } from '@/lib/api/config';
import { Loader2 } from 'lucide-react';
import type { AuthProviderPublic } from '../types';

export function LandingPage() {
  const { registrationEnabled } = useAuth();
  const { t, ready } = useModuleTranslation('auth');
  const setActiveModal = useAuthModalStore((state) => state.setActiveModal);
  const [providers, setProviders] = React.useState<AuthProviderPublic[]>([]);
  const [loadingProviders, setLoadingProviders] = React.useState(true);

  React.useEffect(() => {
    getAuthProviders()
      .then(setProviders)
      .catch(() => setProviders([]))
      .finally(() => setLoadingProviders(false));
  }, []);

  const oauthProviders = providers.filter((p) => p.type === 'oauth');
  const classicProvider = providers.find((p) => p.type === 'classic');
  const showClassicAuth = !!classicProvider;
  const hasAnyProvider = oauthProviders.length > 0 || showClassicAuth;

  if (!ready) {
    return null;
  }

  return (
    <AuthScrollShell>
      {/* hidden on mobile */}
      <StarsBackground shootingStars={true} />

      {/* Header - Minimal, just logo */}
      <div className='absolute top-6 left-6 z-20'>
        <div className='flex items-center gap-2'>
          <NavLink to='/' className='flex items-center mb-4'>
            <AppBrandLogo className='h-12 w-56' />
          </NavLink>{' '}
        </div>
      </div>
      {/* Main content - centered vertically, left aligned */}
      <main className='relative z-10 flex min-h-full flex-col md:items-start items-center px-6 md:px-16 lg:px-24'>
        {/* Content Wrapper - takes available space and centers content vertically */}
        <div className='flex-1 flex flex-col justify-center items-center md:items-start w-full'>
          <div className='w-full max-w-100 space-y-10'>

            {/* Loading State */}
            {loadingProviders && (
              <div className='space-y-8'>
                <div className='h-10 w-3/4 rounded-lg bg-muted/20 animate-pulse' />
                <div className='w-full space-y-3'>
                  <div className='h-12 w-full rounded-full bg-muted/30 animate-pulse' />
                  <div className='h-12 w-full rounded-full bg-muted/20 animate-pulse' />
                </div>
              </div>
            )}

            {/* No Providers — all auth methods disabled */}
            {!loadingProviders && !hasAnyProvider && (
              <div className='space-y-6'>
                <div className='space-y-3 text-center md:text-left'>
                  <h1 className='text-4xl tracking-tight text-center md:text-left'>{t('landing.noProvidersTitle')}</h1>
                  <p className='text-sm text-muted-foreground'>
                    {t('landing.noProviders')}
                  </p>
                  <p className='text-xs text-muted-foreground/50'>
                    {t('landing.noProvidersHint')}
                  </p>
                </div>
              </div>
            )}

            {/* Auth Buttons Stack — only when loaded and providers exist */}
            {!loadingProviders && hasAnyProvider && (
              <div className='space-y-8'>
                <h1 className='text-4xl tracking-tight text-center md:text-left'>{t('landing.title')}</h1>
              <div className='space-y-4'>
                {/* Dynamic OAuth Provider Buttons */}
                {oauthProviders.map((provider) => (
                  <Button
                    key={provider.providerKey}
                    size='lg'
                    className='w-full gap-3 rounded-full h-12 text-base font-medium'
                    onClick={() => {
                      window.location.href = `${API_CONFIG.baseURL}/auth/providers/${provider.providerKey}/authorize`;
                    }}>
                    <ProviderIcon iconKey={provider.iconKey} />
                    {t('landing.oauthLogin', { provider: provider.displayName })}
                  </Button>
                ))}

                {/* Email Login - Outline Pill (only if classic auth is enabled) */}
                {showClassicAuth && (
                  <Button size='lg' variant='outline' className='w-full gap-3 rounded-full border-neutral-700 bg-transparent h-12 text-base font-medium' onClick={() => setActiveModal('login')}>
                    <svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                      <rect width='20' height='16' x='2' y='4' rx='2' />
                      <path d='m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' />
                    </svg>
                    {t('landing.emailLogin')}
                  </Button>
                )}
              </div>
              </div>
            )}

            {/* Sign Up Link */}
            {!loadingProviders && registrationEnabled && showClassicAuth && (
              <div className='text-sm pl-1 text-center'>
                {t('landing.noAccount')}{' '}
                <button onClick={() => setActiveModal('register')} className='hover:underline font-medium'>
                  {t('landing.signUp')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className='mt-auto py-6 flex flex-wrap gap-1 z-20 text-xs text-neutral-500'>
          <span>{t('landing.footer.agreementPrefix')} </span>
          <a href='https://www.yellowsys.ai/terms' target='_blank' rel='noreferrer' className='hover:underline font-bold'>
            {t('landing.footer.terms')}
          </a>
          <span> {t('landing.footer.and')} </span>
          <a href='https://www.yellowsys.ai/privacy' target='_blank' rel='noreferrer' className='hover:underline font-bold'>
            {t('landing.footer.privacy')}
          </a>
          <span> {t('landing.footer.agreementSuffix', { appName: appConfig.name })}</span>
        </footer>
      </main>

      {/* Auth Modals */}
      <AuthModals />
    </AuthScrollShell>
  );
}
