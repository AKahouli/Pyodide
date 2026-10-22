import { useEffect, useState } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';

interface TypewriterStreamdownProps {
  text: string;
  /** When false the full text is shown immediately (e.g. replayed history). */
  enabled: boolean;
  className?: string;
  /** Characters revealed per 16 ms (~60fps frame). Higher = faster. Default 4. */
  charsPerFrame?: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Progressively reveals markdown text through Streamdown to fake a streaming
 * typewriter effect. When `enabled` is false (replayed history) the full text
 * renders instantly.
 *
 * The reveal is skipped entirely for users who asked for reduced motion: a
 * character-by-character trickle is exactly the kind of motion that setting is
 * meant to suppress, and a screen reader announcing it token by token is worse
 * than the full text arriving at once.
 */
export function TypewriterStreamdown({
  text,
  enabled,
  className,
  charsPerFrame = 4,
}: TypewriterStreamdownProps) {
  const animate = enabled && !prefersReducedMotion();
  const [revealed, setRevealed] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) {
      setRevealed(text.length);
      return;
    }
    setRevealed(0);
    const id = window.setInterval(() => {
      setRevealed((r) => {
        const next = r + charsPerFrame;
        if (next >= text.length) {
          window.clearInterval(id);
          return text.length;
        }
        return next;
      });
    }, 16);
    return () => window.clearInterval(id);
  }, [animate, text, charsPerFrame]);

  const fullyRevealed = revealed >= text.length;
  const slice = fullyRevealed ? text : text.slice(0, revealed);

  return (
    <div className={cn('relative', className)}>
      <Streamdown
        className={cn(
          'prose prose-sm max-w-none text-sm text-foreground dark:prose-invert',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        )}
      >
        {slice}
      </Streamdown>
      {!fullyRevealed && (
        <span className='ms-0.5 inline-block h-3 w-[2px] animate-pulse bg-muted-foreground/60 align-baseline motion-reduce:animate-none' />
      )}
    </div>
  );
}
