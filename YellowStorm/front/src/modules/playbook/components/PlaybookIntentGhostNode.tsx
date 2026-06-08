import { useModuleTranslation } from '@/modules/localization';

type PlaybookIntentGhostNodeProps = {
  progress?: string;
};

const PROGRESS_SEGMENTS = [0, 0.18, 0.36, 0.54];

export function PlaybookIntentGhostNode({ progress }: PlaybookIntentGhostNodeProps) {
  const { t } = useModuleTranslation('playbook');
  const progressText = progress || t('canvas.intentAnalyzingHint');

  return (
    <>
      <style>{`
        @keyframes intent-progress-sweep {
          0% { transform: translateX(-130%); opacity: 0; }
          12% { opacity: 1; }
          88% { opacity: 1; }
          100% { transform: translateX(330%); opacity: 0; }
        }
        @keyframes intent-progress-sweep-reverse {
          0% { transform: translateX(330%); opacity: 0; }
          12% { opacity: 1; }
          88% { opacity: 1; }
          100% { transform: translateX(-130%); opacity: 0; }
        }
        @keyframes intent-progress-pulse {
          0%, 100% { opacity: 0.28; transform: scaleY(0.72); }
          50% { opacity: 1; transform: scaleY(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .intent-progress-pulse {
            animation: none !important;
          }
        }
      `}</style>
      <div data-testid="intent-ghost-overlay" className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-md overflow-hidden rounded-2xl border border-primary/20 bg-background/90 px-4 py-3 shadow-2xl shadow-primary/10 backdrop-blur-md"
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{t('canvas.intentAnalyzing')}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{progressText}</div>
            </div>
            <div className="flex h-8 items-end gap-1.5" aria-hidden="true">
              {PROGRESS_SEGMENTS.map((delay) => (
                <span
                  key={delay}
                  className="intent-progress-pulse block h-6 w-1.5 rounded-full bg-primary/70"
                  style={{ animation: `intent-progress-pulse 1.15s ease-in-out ${delay}s infinite` }}
                />
              ))}
            </div>
          </div>

          <div className="relative h-1.5 overflow-hidden rounded-full bg-primary/15" aria-hidden="true">
            <div
              data-testid="intent-progress-sweep-forward"
              className="intent-progress-animated absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent shadow-[0_0_14px_hsl(var(--primary)/0.75)]"
              style={{ animation: 'intent-progress-sweep 1.8s linear infinite' }}
            />
            <div
              data-testid="intent-progress-sweep-reverse"
              className="intent-progress-animated absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary/80 to-transparent shadow-[0_0_14px_hsl(var(--primary)/0.6)]"
              style={{ animation: 'intent-progress-sweep-reverse 1.8s linear 0.9s infinite' }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
