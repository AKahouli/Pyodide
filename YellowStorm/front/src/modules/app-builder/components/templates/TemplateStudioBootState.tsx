import { useEffect, useMemo, useState } from 'react';
import { Check, Package, Server, Sparkles, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import './template-studio-motion.css';

const BOOT_STEPS = [
  { id: 'unpack', icon: Package, afterMs: 0 },
  { id: 'install', icon: Terminal, afterMs: 2800 },
  { id: 'server', icon: Server, afterMs: 7000 },
  { id: 'ready', icon: Sparkles, afterMs: 12000 },
] as const;

type BootStepId = (typeof BOOT_STEPS)[number]['id'];

interface TemplateStudioBootStateProps {
  className?: string;
}

/**
 * Polished NodePod boot presentation shown while the local preview starts.
 * Steps advance on a soft timer (real boot is async); the last step holds until ready.
 */
export function TemplateStudioBootState({ className }: TemplateStudioBootStateProps) {
  const { t } = useModuleTranslation('app-builder');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timers = BOOT_STEPS.slice(1).map((step, index) =>
      window.setTimeout(() => setActiveIndex(index + 1), step.afterMs),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  const labels = useMemo(
    () =>
      ({
        unpack: t('templateStudio.bootUnpack'),
        install: t('templateStudio.bootInstall'),
        server: t('templateStudio.bootServer'),
        ready: t('templateStudio.bootReady'),
      }) satisfies Record<BootStepId, string>,
    [t],
  );

  const progress = Math.min(92, 18 + activeIndex * 24);

  return (
    <div
      className={cn(
        'relative flex h-full min-h-[16rem] items-center justify-center overflow-hidden sm:min-h-[22rem]',
        className,
      )}
      role='status'
      aria-live='polite'
      aria-busy='true'
    >
      {/* Soft ambient field */}
      <div className='pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-muted/40' aria-hidden />
      <div
        className='pointer-events-none absolute -left-16 top-8 size-48 rounded-full bg-primary/10 blur-3xl motion-safe:animate-[ts-boot-breathe_4.5s_ease-in-out_infinite]'
        aria-hidden
      />
      <div
        className='pointer-events-none absolute -right-10 bottom-6 size-56 rounded-full bg-muted-foreground/10 blur-3xl motion-safe:animate-[ts-boot-breathe_5.5s_ease-in-out_infinite]'
        aria-hidden
      />

      {/* Skeleton app canvas */}
      <div
        className='pointer-events-none absolute inset-x-8 top-10 bottom-28 hidden overflow-hidden rounded-lg border border-border/40 bg-background/40 opacity-70 sm:block'
        aria-hidden
      >
        <div className='flex h-9 items-center gap-2 border-b border-border/40 px-3'>
          <span className='size-2 rounded-full bg-border' />
          <span className='size-2 rounded-full bg-border' />
          <span className='size-2 rounded-full bg-border' />
          <div className='ms-2 h-4 flex-1 rounded-md ts-boot-shimmer' />
        </div>
        <div className='grid h-[calc(100%-2.25rem)] grid-cols-[7rem_1fr] gap-3 p-3'>
          <div className='space-y-2 rounded-md border border-border/30 p-2'>
            <div className='h-3 w-[80%] rounded ts-boot-shimmer' />
            <div className='h-3 w-[60%] rounded ts-boot-shimmer' />
            <div className='h-3 w-[68%] rounded ts-boot-shimmer' />
          </div>
          <div className='space-y-3 rounded-md border border-border/30 p-3'>
            <div className='h-5 w-[40%] rounded ts-boot-shimmer' />
            <div className='h-24 w-full rounded-md ts-boot-shimmer' />
            <div className='grid grid-cols-3 gap-2'>
              <div className='h-10 rounded ts-boot-shimmer' />
              <div className='h-10 rounded ts-boot-shimmer' />
              <div className='h-10 rounded ts-boot-shimmer' />
            </div>
          </div>
        </div>
      </div>

      <div className='relative z-10 mx-auto flex w-full max-w-md flex-col items-center gap-5 px-6 py-8 animate-in fade-in-0 zoom-in-95 duration-500'>
        {/* Orbit mark */}
        <div className='relative flex size-16 items-center justify-center'>
          <div
            className='absolute inset-0 rounded-full border border-dashed border-primary/35 motion-safe:animate-[ts-boot-orbit_10s_linear_infinite]'
            aria-hidden
          />
          <div className='absolute inset-2 rounded-full bg-primary/10' aria-hidden />
          <Sparkles className='relative size-6 text-primary' aria-hidden />
        </div>

        <div className='space-y-1.5 text-center'>
          <p className='text-base font-semibold tracking-tight text-foreground'>
            {t('templateStudio.preparingTitle')}
          </p>
          <p className='text-sm leading-relaxed text-muted-foreground'>
            {t('templateStudio.preparingHint')}
          </p>
        </div>

        <div className='w-full space-y-3 rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm backdrop-blur-sm'>
          <div className='relative h-1.5 overflow-hidden rounded-full bg-muted'>
            <div
              className='absolute inset-y-0 left-0 rounded-full bg-primary/80 transition-[width] duration-700 ease-out'
              style={{ width: `${progress}%` }}
            />
            <div className='absolute inset-y-0 w-1/3 rounded-full bg-primary/40 ts-boot-progress-indeterminate' />
          </div>

          <ol className='space-y-2'>
            {BOOT_STEPS.map((step, index) => {
              const Icon = step.icon;
              const done = index < activeIndex;
              const current = index === activeIndex;
              return (
                <li
                  key={step.id}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-300',
                    current && 'bg-primary/10 text-foreground',
                    done && 'text-muted-foreground',
                    !done && !current && 'text-muted-foreground/55',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full border transition-all duration-300',
                      done && 'border-primary/40 bg-primary/15 text-primary',
                      current && 'border-primary/50 bg-primary/10 text-primary',
                      !done && !current && 'border-border bg-muted/40',
                    )}
                  >
                    {done ? (
                      <Check className='size-3.5 animate-in zoom-in-50 duration-200' aria-hidden />
                    ) : (
                      <Icon
                        className={cn('size-3.5', current && 'motion-safe:animate-pulse')}
                        aria-hidden
                      />
                    )}
                  </span>
                  <span className={cn(current && 'font-medium')}>{labels[step.id]}</span>
                  {current ? (
                    <span className='ms-auto flex gap-0.5' aria-hidden>
                      {[0, 1, 2].map((dot) => (
                        <span
                          key={dot}
                          className='size-1 rounded-full bg-primary/70 motion-safe:animate-pulse'
                          style={{ animationDelay: `${dot * 160}ms` }}
                        />
                      ))}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
