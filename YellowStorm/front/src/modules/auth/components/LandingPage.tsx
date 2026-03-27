import * as React from 'react';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/config/app';
import { AuthModals } from './modals/AuthModals';
import { NavLink } from 'react-router-dom';
import { Icons, AppLogo } from '@/components/icons';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '../useAuth';
import { useAuthModalStore } from '../store';

export function LandingPage() {
  const { registrationEnabled } = useAuth();
  const { t, ready } = useModuleTranslation('auth');
  const setActiveModal = useAuthModalStore((state) => state.setActiveModal);

  if (!ready) {
    return null;
  }

  return (
    <div className='relative min-h-screen w-full overflow-hidden'>
      {/* hidden on mobile */}
      <StarsBackground shootingStars={true} />

      {/* Header - Minimal, just logo */}
      <div className='absolute top-6 left-6 z-20'>
        <div className='flex items-center gap-2'>
          <NavLink to='/' className='flex items-center mb-4'>
            <AppLogo className='h-12 w-56' />
          </NavLink>{' '}
        </div>
      </div>
      {/* Main content - centered vertically, left aligned */}
      <main className='relative z-10 flex min-h-screen flex-col md:items-start items-center px-6 md:px-16 lg:px-24'>
        {/* Content Wrapper - takes available space and centers content vertically */}
        <div className='flex-1 flex flex-col justify-center items-center md:items-start w-full'>
          <div className='w-full max-w-100 space-y-10'>
            {/* Heading */}
            <div className='space-y-2'>
              <h1 className='text-4xl  tracking-tight sm:text-4xl md:text-4xl text-center md:text-left'>{t('landing.title')}</h1>
            </div>

            {/* Auth Buttons Stack */}
            <div className='space-y-4'>
              {/* Microsoft Login - Primary White Pill */}
              <Button
                size='lg'
                disabled
                className='w-full gap-3 rounded-full h-12 text-base font-medium '
                onClick={() => {
                  // TODO: Implement Microsoft OAuth
                  setActiveModal('login');
                }}>
                <svg className='h-5 w-5' viewBox='0 0 23 23' xmlns='http://www.w3.org/2000/svg'>
                  <path fill='#f35325' d='M1 1h10v10H1z' />
                  <path fill='#81bc06' d='M12 1h10v10H12z' />
                  <path fill='#05a6f0' d='M1 12h10v10H1z' />
                  <path fill='#ffba08' d='M12 12h10v10H12z' />
                </svg>
                {t('landing.microsoftLogin')}
              </Button>

              {/* Email Login - Outline Pill */}
              <Button size='lg' variant='outline' className='w-full gap-3 rounded-full border-neutral-700 bg-transparent  h-12 text-base font-medium' onClick={() => setActiveModal('login')}>
                <svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                  <rect width='20' height='16' x='2' y='4' rx='2' />
                  <path d='m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' />
                </svg>
                {t('landing.emailLogin')}
              </Button>
            </div>

            {/* Sign Up Link */}
            {registrationEnabled && (
              <div className='text-sm  pl-1 text-center '>
                {t('landing.noAccount')}{' '}
                <button onClick={() => setActiveModal('register')} className=' hover:underline font-medium'>
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
    </div>
  );
}
