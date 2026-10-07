import { useNavigate } from 'react-router-dom';
import { ArrowRight, Boxes, Eye, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { appBuilderStudioApi } from './api';
import { useAppBuilderStudioPointersStore, useAppBuilderStudioStore } from './store';
import { studioSessionPath, APP_MARKET_PATH } from './studio-paths';
import { useAppBuilderStudioTranslation } from './translation';

export default function AppBuilderStudioPage() {
  const navigate = useNavigate();
  const reset = useAppBuilderStudioStore((s) => s.reset);
  const prependPointer = useAppBuilderStudioPointersStore((s) => s.prepend);
  const { t } = useAppBuilderStudioTranslation();

  const startNew = async () => {
    reset();
    const { sessionId, workspaceIds } = await appBuilderStudioApi.createSession();
    prependPointer({
      sessionId,
      title: '',
      status: 'active',
      lastEventAt: new Date().toISOString(),
      isShared: false,
      workspaceIds,
    });
    navigate(studioSessionPath(sessionId));
  };

  const highlights = [
    { icon: Wand2, label: t('page.highlights.agent') },
    { icon: Eye, label: t('page.highlights.preview') },
    { icon: Boxes, label: t('page.highlights.deploy') },
  ] as const;

  return (
    <div className='relative flex h-full w-full flex-col overflow-hidden bg-background'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.08),transparent_55%)]'
      />
      <div className='relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 px-6 py-12 text-center'>
        <div className='inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground shadow-sm backdrop-blur'>
          <Sparkles className='size-3.5 text-primary' aria-hidden />
          {t('page.eyebrow')}
        </div>

        <div className='space-y-3'>
          <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>{t('page.title')}</h1>
          <p className='mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base'>
            {t('page.emptyState')}
          </p>
        </div>

        <div className='flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-center'>
          <Button size='lg' className='gap-2 shadow-sm' onClick={startNew}>
            {t('page.newChat')}
            <ArrowRight className='size-4' aria-hidden />
          </Button>
          <Button
            size='lg'
            variant='outline'
            className='gap-2'
            onClick={() => navigate(APP_MARKET_PATH)}
          >
            {t('page.backToMarket')}
          </Button>
        </div>

        <ul className='grid w-full max-w-xl gap-2 sm:grid-cols-3'>
          {highlights.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className={cn(
                'flex items-center justify-center gap-2 rounded-xl border border-border/60',
                'bg-card/50 px-3 py-2.5 text-xs font-medium text-muted-foreground',
              )}
            >
              <Icon className='size-3.5 shrink-0 text-primary' aria-hidden />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
