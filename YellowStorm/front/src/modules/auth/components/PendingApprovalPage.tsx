import { Check, LogOut, Mail, X } from 'lucide-react';
import { AppLogo } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import { useModuleTranslation, type ModuleTranslationKey } from '@/modules/localization';

type AuthKey = ModuleTranslationKey<'auth'>;

const PENDING_APPROVAL_HERO_SRC = '/pending-approval-hero.png';

type StepState = 'done' | 'current' | 'upcoming' | 'rejected';
type StepId = 'signup' | 'validation' | 'access';
type ApprovalStatus = 'pending' | 'approved' | 'rejected';

interface PendingApprovalPageProps {
  onLogout: () => void;
  status?: ApprovalStatus;
}

function getSteps(status: ApprovalStatus): ReadonlyArray<{ id: StepId; state: StepState }> {
  if (status === 'approved') {
    return [
      { id: 'signup', state: 'done' },
      { id: 'validation', state: 'done' },
      { id: 'access', state: 'done' },
    ];
  }
  if (status === 'rejected') {
    return [
      { id: 'signup', state: 'done' },
      { id: 'validation', state: 'done' },
      { id: 'access', state: 'rejected' },
    ];
  }
  return [
    { id: 'signup', state: 'done' },
    { id: 'validation', state: 'current' },
    { id: 'access', state: 'upcoming' },
  ];
}

function stepStatusKey(id: StepId, state: StepState): AuthKey {
  if (state === 'done' && (id === 'validation' || id === 'access')) {
    return `pendingApproval.steps.${id}.statusDone`;
  }
  if (id === 'access' && state === 'rejected') {
    return 'pendingApproval.steps.access.statusRejected';
  }
  return `pendingApproval.steps.${id}.status`;
}

function statusClassName(state: StepState): string {
  if (state === 'current') {
    return 'mt-1 text-xs font-medium text-orange-400';
  }
  if (state === 'rejected') {
    return 'mt-1 text-xs font-semibold text-red-500';
  }
  return 'mt-1 text-xs text-neutral-500';
}

function PendingApprovalHero({ alt }: { alt: string }) {
  return (
    <img
      src={PENDING_APPROVAL_HERO_SRC}
      alt={alt}
      className='mx-auto h-44 w-auto object-contain sm:h-52'
    />
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <span className='flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-white'>
        <Check className='h-4 w-4' strokeWidth={3} />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className='flex h-8 w-8 items-center justify-center rounded-full border-2 border-orange-500'>
        <span className='h-2.5 w-2.5 rounded-full bg-orange-500' />
      </span>
    );
  }
  if (state === 'rejected') {
    return (
      <span className='flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white'>
        <X className='h-4 w-4' strokeWidth={3} />
      </span>
    );
  }
  return <span className='h-8 w-8 rounded-full border-2 border-neutral-600' />;
}

export function PendingApprovalPage({ onLogout, status = 'pending' }: PendingApprovalPageProps) {
  const { t } = useModuleTranslation('auth');
  const steps = getSteps(status);
  const messageKey: AuthKey =
    status === 'approved'
      ? 'pendingApproval.messageApproved'
      : status === 'rejected'
        ? 'pendingApproval.messageRejected'
        : 'pendingApproval.message';

  return (
    <div className='fixed inset-0 z-[100] bg-[#0b0b0b]'>
      <div className='relative flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto'>
        <StarsBackground shootingStars={false} />

        <header className='absolute top-6 left-6 z-20'>
          <AppLogo className='h-12 w-56' />
        </header>

        <main className='relative z-10 flex min-h-full flex-col items-center justify-center px-4 py-24'>
          <section
            role='status'
            aria-labelledby='pending-approval-title'
            aria-describedby='pending-approval-message'
            className='relative w-full max-w-lg rounded-[24px] border border-white/10 bg-white/[0.04] px-6 py-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm'
          >
            <PendingApprovalHero alt={t('pendingApproval.heroAlt')} />

            <h1 id='pending-approval-title' className='mt-2 text-[28px] font-semibold leading-tight tracking-tight text-white'>
              {t('pendingApproval.welcomePrefix')}
              <span className='bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent'>
                {t('pendingApproval.welcomeAccent')}
              </span>
            </h1>
            <p className='mt-2 text-sm text-neutral-400'>{t('pendingApproval.success')}</p>

            <ol className='mt-8 grid grid-cols-3 gap-2 rounded-2xl bg-black/35 px-3 py-4'>
              {steps.map((step, index) => (
                <li key={step.id} className='relative flex flex-col items-center text-center'>
                  {index < steps.length - 1 ? (
                    <span aria-hidden className='absolute top-4 left-[calc(50%+18px)] right-[calc(-50%+18px)] border-t border-dotted border-neutral-600' />
                  ) : null}
                  <span className='relative z-10'>
                    <StepIcon state={step.state} />
                  </span>
                  <p className='relative z-10 mt-3 text-xs font-semibold text-white'>{t(`pendingApproval.steps.${step.id}.label`)}</p>
                  <p className={`relative z-10 ${statusClassName(step.state)}`}>{t(stepStatusKey(step.id, step.state))}</p>
                </li>
              ))}
            </ol>

            <p
              id='pending-approval-message'
              className={
                status === 'rejected'
                  ? 'mt-6 text-sm leading-relaxed text-red-200'
                  : status === 'approved'
                    ? 'mt-6 text-sm leading-relaxed text-green-200'
                    : 'mt-6 text-sm leading-relaxed text-neutral-300'
              }
            >
              {t(messageKey)}
            </p>

            {status === 'pending' && (
              <p className='mt-5 flex items-center justify-center gap-2 rounded-xl bg-black/40 px-4 py-3 text-sm text-neutral-300'>
                <Mail aria-hidden className='h-4 w-4 shrink-0 text-orange-400' />
                {t('pendingApproval.emailHint')}
              </p>
            )}

            <Button
              type='button'
              variant='outline'
              size='lg'
              onClick={onLogout}
              className='mt-6 h-11 w-full rounded-xl border-orange-500/40 bg-transparent font-semibold text-white hover:bg-orange-500/10 hover:text-white'
            >
              <LogOut className='h-4 w-4' />
              {t('pendingApproval.logout')}
            </Button>
          </section>
        </main>
      </div>
    </div>
  );
}
