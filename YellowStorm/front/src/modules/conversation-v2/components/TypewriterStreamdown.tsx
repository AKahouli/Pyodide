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

/**
 * Progressively reveals markdown text through Streamdown to fake a streaming
 * typewriter effect. When `enabled` is false (replayed history) the full text
 * renders instantly.
 */
export function TypewriterStreamdown({
  text,
  enabled,
  className,
  charsPerFrame = 4,
}: TypewriterStreamdownProps) {
  const [revealed, setRevealed] = useState(enabled ? 0 : text.length);

  useEffect(() => {
    if (!enabled) {
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
  }, [enabled, text, charsPerFrame]);

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
        <span className='ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-muted-foreground/60 align-baseline' />
      )}
    </div>
  );
}
