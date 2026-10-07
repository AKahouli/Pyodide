import { ExternalLinkIcon } from 'lucide-react';
import { WebPreview, WebPreviewBody, WebPreviewNavigation, WebPreviewNavigationButton, WebPreviewUrl } from '@/components/ai-elements/web-preview';
import type { ToolContent } from '../../../types';

type WebPage = Extract<ToolContent, { kind: 'webpage' }>;

interface WebPageToolViewProps {
  content: WebPage;
}

/**
 * Renders a backend-pushed URL inside an <iframe> via the shared WebPreview
 * component. Unlike BrowserToolView (live VNC / screenshot of the agent's own
 * browser), this embeds the page itself. Note: sites sending X-Frame-Options
 * or CSP `frame-ancestors` will refuse to load — the "open in new tab" button
 * is the fallback.
 */
export function WebPageToolView({ content }: WebPageToolViewProps) {
  return (
    <WebPreview defaultUrl={content.url} className='size-full rounded-none border-0 bg-transparent'>
      <WebPreviewNavigation>
        <WebPreviewUrl readOnly value={content.url} />
        <WebPreviewNavigationButton tooltip='Open in new tab' onClick={() => window.open(content.url, '_blank', 'noreferrer')}>
          <ExternalLinkIcon className='size-4' />
        </WebPreviewNavigationButton>
      </WebPreviewNavigation>
      <WebPreviewBody />
    </WebPreview>
  );
}
