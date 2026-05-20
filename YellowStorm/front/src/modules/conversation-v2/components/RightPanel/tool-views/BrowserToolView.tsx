import { useEffect, useRef, useState } from 'react';
import { ExternalLinkIcon, MonitorIcon } from 'lucide-react';
import RFB from '@novnc/novnc';
import { Button } from '@/components/ui/button';
import { useVncSession } from '../../../hooks/useVncSession';
import { useConversationV2Store } from '../../../store';
import { useConversationV2Translation } from '../../../translation';
import type { ToolContent } from '../../../types';

type Browser = Extract<ToolContent, { kind: 'browser' }>;

interface BrowserToolViewProps {
  content: Browser;
  /** True when this tool call is the live one and the session is still streaming. */
  isLive?: boolean;
}

export function BrowserToolView({ content, isLive }: BrowserToolViewProps) {
  const { t } = useConversationV2Translation();
  const sessionId = useConversationV2Store((s) => s.sessionId);

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-9 shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-xs text-muted-foreground'>
            {content.url || content.title || t('tools.browser.title')}
          </span>
        </div>
        {content.url && (
          <a
            href={content.url}
            target='_blank'
            rel='noreferrer'
            className='shrink-0 text-muted-foreground hover:text-foreground'
            aria-label={t('tools.browser.openInNewTab')}
          >
            <ExternalLinkIcon className='size-3.5' />
          </a>
        )}
      </div>
      <div className='relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/10'>
        {isLive ? (
          <LiveBrowserViewer sessionId={sessionId} fallback={content.screenshot_url} />
        ) : content.screenshot_url ? (
          <img
            src={content.screenshot_url}
            alt='browser screenshot'
            loading='lazy'
            className='max-h-full max-w-full object-contain'
          />
        ) : null}
      </div>
    </div>
  );
}

function LiveBrowserViewer({
  sessionId,
  fallback,
}: {
  sessionId: string | null;
  fallback: string;
}) {
  const { t } = useConversationV2Translation();
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<InstanceType<typeof RFB> | null>(null);
  const vnc = useVncSession(sessionId, { autoStart: true });
  const [interactive, setInteractive] = useState(false);


  useEffect(() => {
    if (!vnc.url || !screenRef.current) return;
    const rfb = new RFB(screenRef.current, vnc.url, { credentials: { password: '' } });
    rfb.viewOnly = true;
    rfb.scaleViewport = true;
    rfb.addEventListener('connect', () => {
      vnc.markConnected();
    });
    rfb.addEventListener('disconnect', (e: { detail?: { clean?: boolean } }) => {
      if (!e.detail?.clean) vnc.markError('disconnected');
    });
    rfbRef.current = rfb;
    return () => {
      try {
        rfb.disconnect();
      } catch {
        /* noop */
      }
      rfbRef.current = null;
    };
  // Only re-create when the URL changes — not when status transitions connecting → connected,
  // which would call rfb.disconnect() immediately after connect.
  }, [vnc.url]);

  const takeOver = () => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.viewOnly = !rfb.viewOnly;
    setInteractive(!rfb.viewOnly);
    if (rfb.viewOnly) vnc.markConnected();
    else vnc.markTakenOver();
  };

  if (vnc.status === 'unavailable' || vnc.status === 'error') {
    return (
      <img
        src={fallback}
        alt='browser screenshot'
        loading='lazy'
        className='max-h-full max-w-full object-contain'
      />
    );
  }

  return (
    <>
      <div ref={screenRef} className='size-full bg-black' />
      <Button
        type='button'
        onClick={takeOver}
        size='sm'
        variant='secondary'
        className='absolute bottom-3 right-3 gap-1 rounded-full shadow-md'
      >
        <MonitorIcon className='size-4' />
        {interactive ? t('vnc.release') : t('vnc.takeOver')}
      </Button>
    </>
  );
}
