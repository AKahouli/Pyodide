import { ExternalLinkIcon } from 'lucide-react';
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
} from '@/components/ai-elements/web-preview';

interface ApplicationComponentViewProps {
  url: string;
  title?: string;
}

/**
 * Renders an agent-pushed "application component" (an embeddable web app /
 * preview) inside an <iframe> via the shared WebPreview component. Driven by the
 * `application_component` event rather than a tool call — the agent asks the app
 * to display this URL in the side panel. Sites sending X-Frame-Options or CSP
 * `frame-ancestors` refuse to load in the iframe; the "open in new tab" button
 * is the fallback.
 */
export function ApplicationComponentView({ url, title }: ApplicationComponentViewProps) {
  return (
    <WebPreview defaultUrl={url} className='size-full rounded-none border-0 bg-transparent'>
      <WebPreviewNavigation>
        {/* Show the human-friendly title in the address bar (fall back to the
            URL when untitled). `title={url}` keeps the real URL on hover, and
            the button below still opens the actual URL. The iframe itself reads
            the URL from WebPreview context, so this display-only swap is safe. */}
        <WebPreviewUrl readOnly value={title || url} title={url} />
        <WebPreviewNavigationButton
          tooltip='Open in new tab'
          onClick={() => window.open(url, '_blank', 'noreferrer')}
        >
          <ExternalLinkIcon className='size-4' />
        </WebPreviewNavigationButton>
      </WebPreviewNavigation>
      <WebPreviewBody />
    </WebPreview>
  );
}
