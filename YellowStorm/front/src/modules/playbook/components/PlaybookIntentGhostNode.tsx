import { useModuleTranslation } from '@/modules/localization';

const ORBITING_PARTICLES = [
  { top: '18%', left: '22%', delay: '0s' },
  { top: '26%', left: '78%', delay: '0.6s' },
  { top: '68%', left: '16%', delay: '1.2s' },
  { top: '74%', left: '82%', delay: '1.8s' },
];

const SIGNAL_STREAMS = [
  { left: '4%', top: '28%', width: '40%', rotate: '14deg', delay: '0s' },
  { left: '7%', top: '70%', width: '37%', rotate: '-18deg', delay: '0.35s' },
  { right: '5%', top: '23%', width: '38%', rotate: '166deg', delay: '0.7s' },
  { right: '8%', top: '73%', width: '40%', rotate: '198deg', delay: '1.05s' },
  { left: '50%', top: '8%', width: '28%', rotate: '90deg', delay: '1.4s' },
  { left: '50%', bottom: '8%', width: '28%', rotate: '270deg', delay: '1.75s' },
];

export function PlaybookIntentGhostNode() {
  const { t } = useModuleTranslation('playbook');

  return (
    <>
      <style>{`
        @keyframes intent-ghost-ring {
          0% { opacity: 0.5; transform: scale(0.88); }
          65%, 100% { opacity: 0; transform: scale(1.4); }
        }
        @keyframes intent-ghost-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes intent-ghost-scan {
          0% { transform: translateX(-125%); opacity: 0; }
          20% { opacity: 0.9; }
          100% { transform: translateX(125%); opacity: 0; }
        }
        @keyframes intent-ghost-dot {
          0%, 100% { opacity: 0.25; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        @keyframes intent-ghost-stream {
          0% { opacity: 0.16; background-position: 0% 50%; }
          50% { opacity: 0.9; background-position: 100% 50%; }
          100% { opacity: 0.16; background-position: 200% 50%; }
        }
        @keyframes intent-ghost-travel {
          0% { opacity: 0; transform: translate(0, -50%) scale(0.75); }
          12% { opacity: 1; }
          88% { opacity: 1; }
          100% { opacity: 0; transform: translate(var(--travel-distance), -50%) scale(1.05); }
        }
        @keyframes intent-ghost-ripple {
          0%, 100% { opacity: 0.24; transform: scale(0.96); }
          50% { opacity: 0.5; transform: scale(1.04); }
        }
        @keyframes intent-ghost-core {
          0%, 100% { opacity: 0.35; transform: translate(-50%, -50%) scale(0.95); }
          50% { opacity: 0.65; transform: translate(-50%, -50%) scale(1.08); }
        }
        @media (prefers-reduced-motion: reduce) {
          .intent-ghost-animated {
            animation: none !important;
          }
        }
      `}</style>
      <div data-testid="intent-ghost-overlay" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div
            className="intent-ghost-animated absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.16)_0%,transparent_68%)] blur-2xl"
            style={{ animation: 'intent-ghost-ripple 4.8s ease-in-out infinite' }}
          />
          <div
            className="intent-ghost-animated absolute left-1/2 top-1/2 h-24 w-24 rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.45)_0%,transparent_70%)] blur-xl"
            style={{ animation: 'intent-ghost-core 2.4s ease-in-out infinite' }}
          />
          {SIGNAL_STREAMS.map((stream) => (
            <div
              key={`${stream.left ?? stream.right}-${stream.top}`}
              className="absolute"
              style={{
                left: stream.left,
                right: stream.right,
                top: stream.top,
                bottom: stream.bottom,
                width: stream.width,
                transform: `rotate(${stream.rotate})`,
                transformOrigin: stream.left ? 'left center' : 'right center',
              }}
            >
              <div className="relative h-1 w-full overflow-visible">
                <div
                  className="intent-ghost-animated absolute inset-0 rounded-full bg-[linear-gradient(90deg,transparent_0%,hsl(var(--primary)/0.12)_8%,hsl(var(--primary)/0.55)_24%,hsl(var(--primary)/0.95)_50%,hsl(var(--primary)/0.55)_76%,hsl(var(--primary)/0.12)_92%,transparent_100%)] bg-[length:220%_100%]"
                  style={{ animation: `intent-ghost-stream 2.6s linear ${stream.delay} infinite` }}
                />
                <div
                  className="intent-ghost-animated absolute left-0 top-1/2 h-3.5 w-3.5 rounded-full bg-primary shadow-[0_0_20px_hsl(var(--primary)/0.75)]"
                  style={{
                    '--travel-distance': 'calc(100% - 0.75rem)',
                    animation: `intent-ghost-travel 2.6s linear ${stream.delay} infinite`,
                  } as React.CSSProperties}
                />
                <div
                  className="intent-ghost-animated absolute left-0 top-1/2 h-2 w-10 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)/0.65),transparent)] blur-[2px]"
                  style={{
                    '--travel-distance': 'calc(100% - 2.5rem)',
                    animation: `intent-ghost-travel 2.6s linear ${stream.delay} infinite`,
                  } as React.CSSProperties}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="relative flex flex-col items-center gap-4">
          <div className="relative h-44 w-80">
            {[0, 0.7, 1.4].map((delay) => (
              <div
                key={delay}
                className="intent-ghost-animated absolute left-1/2 top-1/2 h-28 w-52 -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-primary/25"
                style={{ animation: `intent-ghost-ring 2.8s ease-out ${delay}s infinite` }}
              />
            ))}

            {ORBITING_PARTICLES.map((particle) => (
              <span
                key={`${particle.top}-${particle.left}`}
                className="intent-ghost-animated absolute h-2.5 w-2.5 rounded-full bg-primary/80 shadow-[0_0_18px_hsl(var(--primary)/0.55)]"
                style={{
                  top: particle.top,
                  left: particle.left,
                  animation: `intent-ghost-dot 1.8s ease-in-out ${particle.delay} infinite`,
                }}
              />
            ))}

            <div
              role="status"
              aria-live="polite"
              className="intent-ghost-animated absolute left-1/2 top-1/2 flex h-28 w-52 -translate-x-1/2 -translate-y-1/2 flex-col justify-between overflow-hidden rounded-[2rem] border border-primary/30 bg-background/80 px-5 py-4 shadow-2xl backdrop-blur-sm"
              style={{ animation: 'intent-ghost-float 3.2s ease-in-out infinite' }}
            >
              <div className="absolute inset-x-4 top-0 h-px overflow-hidden rounded-full bg-transparent">
                <div
                  className="intent-ghost-animated h-full w-1/2 bg-gradient-to-r from-transparent via-primary/90 to-transparent"
                  style={{ animation: 'intent-ghost-scan 1.8s ease-in-out infinite' }}
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">
                  {t('canvas.intentAnalyzing')}
                </div>
                <div className="h-2.5 w-24 rounded-full bg-primary/20" />
              </div>

              <div className="space-y-2">
                <div className="h-2 rounded-full bg-muted">
                  <div className="intent-ghost-animated h-full w-2/3 rounded-full bg-primary/45 motion-reduce:animate-none" style={{ animation: 'intent-ghost-scan 2.2s ease-in-out infinite' }} />
                </div>
                <div className="h-2 rounded-full bg-muted/80">
                  <div className="intent-ghost-animated h-full w-1/2 rounded-full bg-primary/30 motion-reduce:animate-none" style={{ animation: 'intent-ghost-scan 2.6s ease-in-out 0.2s infinite' }} />
                </div>
              </div>
            </div>
          </div>

          <p className="max-w-60 text-center text-sm text-muted-foreground">
            {t('canvas.intentAnalyzingHint')}
          </p>
        </div>
      </div>
    </>
  );
}
