import { useModuleTranslation } from '@/modules/localization';

const SPARKLES = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * 360;
  const delay = (i / 12) * 2;
  const distance = 40 + Math.random() * 60;
  return { angle, delay, distance, size: 2 + Math.random() * 4 };
});

interface Props {
  title?: string;
  subtitle?: string;
}

export function PlaybookGeneratingOverlay({ title, subtitle }: Props = {}) {
  const { t } = useModuleTranslation('playbook');
  const displayTitle = title || t('canvas.generating');
  const displaySubtitle = subtitle || t('canvas.generatingHint');

  return (
    <>
      <style>{`
        @keyframes blob-morph-1 {
          0%, 100% { border-radius: 40% 60% 60% 40% / 60% 30% 70% 40%; transform: rotate(0deg) scale(1); }
          25%      { border-radius: 50% 50% 30% 70% / 50% 60% 40% 50%; transform: rotate(90deg) scale(1.05); }
          50%      { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; transform: rotate(180deg) scale(0.95); }
          75%      { border-radius: 60% 40% 50% 50% / 40% 50% 60% 50%; transform: rotate(270deg) scale(1.02); }
        }
        @keyframes blob-morph-2 {
          0%, 100% { border-radius: 50% 50% 30% 70% / 40% 60% 50% 50%; transform: rotate(0deg) scale(1.05); }
          25%      { border-radius: 60% 40% 60% 40% / 50% 40% 60% 50%; transform: rotate(-90deg) scale(0.95); }
          50%      { border-radius: 40% 60% 50% 50% / 60% 50% 40% 60%; transform: rotate(-180deg) scale(1.08); }
          75%      { border-radius: 50% 30% 60% 40% / 40% 60% 50% 50%; transform: rotate(-270deg) scale(1); }
        }
        @keyframes blob-morph-3 {
          0%, 100% { border-radius: 60% 40% 40% 60% / 50% 50% 50% 50%; transform: rotate(0deg) scale(0.9); }
          33%      { border-radius: 40% 60% 50% 50% / 60% 40% 60% 40%; transform: rotate(120deg) scale(1); }
          66%      { border-radius: 50% 50% 60% 40% / 40% 60% 40% 60%; transform: rotate(240deg) scale(0.95); }
        }
        @keyframes gradient-rotate {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes sparkle-burst {
          0% { opacity: 0; transform: translate(0, 0) scale(0); }
          20% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.3); }
        }
        @keyframes shimmer-text {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes pulse-ring {
          0% { opacity: 0.6; transform: scale(0.8); }
          50% { opacity: 0; transform: scale(2); }
          100% { opacity: 0; transform: scale(2); }
        }
        @keyframes dot-pulse {
          0%, 60%, 100% { opacity: 0.2; }
          30% { opacity: 1; }
        }
        .generating-shimmer {
          background: linear-gradient(
            90deg,
            hsl(var(--foreground)) 0%,
            hsl(var(--primary)) 40%,
            hsl(var(--primary)) 60%,
            hsl(var(--foreground)) 100%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer-text 3s ease-in-out infinite;
        }
      `}</style>
      <div className="absolute inset-0 z-50 flex items-center justify-center">
        {/* Blurred backdrop */}
        <div className="absolute inset-0 bg-background/60 backdrop-blur-md" />

        {/* Content */}
        <div className="relative flex flex-col items-center">
          {/* Blob + sparkles + pulse rings container */}
          <div className="relative w-32 h-32 flex items-center justify-center">
            {/* Pulse rings */}
            {[0, 0.8, 1.6].map((delay, i) => (
              <div
                key={i}
                className="absolute inset-0 m-auto w-24 h-24 rounded-full border border-primary/30 pointer-events-none"
                style={{ animation: `pulse-ring 2.4s ease-out ${delay}s infinite` }}
              />
            ))}

            {/* Sparkle particles */}
            {SPARKLES.map((s, i) => {
              const rad = (s.angle * Math.PI) / 180;
              const tx = Math.cos(rad) * s.distance;
              const ty = Math.sin(rad) * s.distance;
              return (
                <div
                  key={i}
                  className="absolute rounded-full bg-primary"
                  style={{
                    width: s.size,
                    height: s.size,
                    left: '50%',
                    top: '50%',
                    marginLeft: -s.size / 2,
                    marginTop: -s.size / 2,
                    '--tx': `${tx}px`,
                    '--ty': `${ty}px`,
                    animation: `sparkle-burst 2s ease-out ${s.delay}s infinite`,
                  } as React.CSSProperties}
                />
              );
            })}

            {/* Morphing blobs */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16">
              {/* Outer blob — large, faint */}
              <div
                className="absolute inset-[-8px] bg-primary/15"
                style={{ animation: 'blob-morph-1 6s ease-in-out infinite' }}
              />
              {/* Middle blob */}
              <div
                className="absolute inset-0 bg-primary/25"
                style={{ animation: 'blob-morph-2 5s ease-in-out infinite' }}
              />
              {/* Inner blob — bright core */}
              <div
                className="absolute inset-[6px] bg-primary/40"
                style={{ animation: 'blob-morph-3 4s ease-in-out infinite' }}
              />
              {/* Rotating gradient highlight */}
              <div
                className="absolute inset-[-4px] opacity-30"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 0%, hsl(var(--primary)) 25%, transparent 50%, hsl(var(--primary)) 75%, transparent 100%)',
                  borderRadius: '50%',
                  animation: 'gradient-rotate 3s linear infinite',
                }}
              />
            </div>
          </div>

          {/* Text */}
          <div className="flex flex-col items-center gap-2 mt-4">
            <span className="generating-shimmer text-lg font-semibold">
              {displayTitle}
            </span>
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              {displaySubtitle}
              <span className="inline-flex items-center gap-0.5 ml-0.5">
                {[0, 0.2, 0.4].map((delay, i) => (
                  <span
                    key={i}
                    className="inline-block w-1 h-1 rounded-full bg-muted-foreground"
                    style={{ animation: `dot-pulse 1.4s ease-in-out ${delay}s infinite` }}
                  />
                ))}
              </span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
