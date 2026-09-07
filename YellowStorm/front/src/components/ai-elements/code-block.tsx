'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { streamMetrics } from '@/modules/conversation/utils/stream-metrics';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { type ComponentProps, createContext, type HTMLAttributes, useContext, useEffect, useRef, useState } from 'react';
import type { BundledLanguage, ShikiTransformer } from 'shiki';

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: BundledLanguage;
  showLineNumbers?: boolean;
  /**
   * While streaming, the block renders plain monospace text and performs NO
   * Shiki work; highlighting happens once, after finalization (dual theme in
   * a single codeToHtml call).
   */
  isStreaming?: boolean;
};

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: '',
});

const lineNumberTransformer: ShikiTransformer = {
  name: 'line-numbers',
  line(node, line) {
    node.children.unshift({
      type: 'element',
      tagName: 'span',
      properties: {
        className: ['inline-block', 'min-w-10', 'mr-4', 'text-right', 'select-none', 'text-muted-foreground'],
      },
      children: [{ type: 'text', value: String(line) }],
    });
  },
};

// Shiki is loaded lazily: the conversation route must not pay for the
// highlighter until a code block actually finalizes (Phase 7 boundary).
type ShikiModule = typeof import('shiki');
let shikiModulePromise: Promise<ShikiModule> | null = null;

function loadShiki(): Promise<ShikiModule> {
  shikiModulePromise ??= import('shiki').catch((error) => {
    // A failed import must not stay cached: keep retrying future blocks with
    // a fresh load instead of a permanently rejected promise.
    shikiModulePromise = null;
    throw error;
  });
  return shikiModulePromise;
}

/**
 * Single-flight dual-theme highlight. One codeToHtml call emits both themes
 * via CSS variables (light default; .dark flips them — see index.css),
 * replacing the previous two-pass light+dark highlighting.
 */
async function highlightCode(code: string, language: BundledLanguage, showLineNumbers = false): Promise<string> {
  const transformers: ShikiTransformer[] = showLineNumbers ? [lineNumberTransformer] : [];
  const { codeToHtml } = await loadShiki();
  return codeToHtml(code, {
    lang: language,
    themes: { light: 'one-light', dark: 'one-dark-pro' },
    defaultColor: 'light',
    transformers,
  });
}

// Bounded result cache: finalized code blocks re-render (tab switches, scroll
// virtualization) without re-paying the highlight. Promise values also dedupe
// concurrent requests for the same input.
const HIGHLIGHT_CACHE_LIMIT = 50;
const highlightCache = new Map<string, Promise<string>>();

function cachedHighlight(code: string, language: BundledLanguage, showLineNumbers: boolean): Promise<string> {
  const key = `${language}\u0000${showLineNumbers ? '1' : '0'}\u0000${code}`;
  const cached = highlightCache.get(key);
  if (cached) {
    // Refresh insertion order so the oldest key is evicted first.
    highlightCache.delete(key);
    highlightCache.set(key, cached);
    return cached;
  }
  const startedAt = performance.now();
  const pending = highlightCode(code, language, showLineNumbers)
    .catch((error) => {
      highlightCache.delete(key);
      throw error;
    })
    .finally(() => {
      streamMetrics.recordHighlight(code.length, performance.now() - startedAt);
    });
  highlightCache.set(key, pending);
  while (highlightCache.size > HIGHLIGHT_CACHE_LIMIT) {
    const oldest = highlightCache.keys().next().value;
    if (oldest === undefined) break;
    highlightCache.delete(oldest);
  }
  return pending;
}

export const CodeBlock = ({ code, language, showLineNumbers = false, isStreaming = false, className, children, ...props }: CodeBlockProps) => {
  // `null` = highlighted HTML for the CURRENT key is not ready (still loading,
  // or highlighting failed): the plain code stays visible and copyable, so a
  // pending or failed highlight can never blank the block.
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (isStreaming) return;
    let cancelled = false;
    setHtml(null); // never keep HTML produced for a previous content key
    cachedHighlight(code, language, showLineNumbers)
      .then((highlighted) => {
        if (!cancelled) setHtml(highlighted);
      })
      .catch((error) => {
        console.error('[CodeBlock] highlighting failed; keeping plain code', error);
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language, showLineNumbers, isStreaming]);

  const showHighlighted = !isStreaming && html !== null;

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div className={cn('group relative w-full overflow-hidden rounded-md border bg-background text-foreground', className)} {...props}>
        {showHighlighted ? (
          <div className='relative'>
            <div
              className='overflow-auto [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm'
              // biome-ignore lint/security/noDangerouslySetInnerHtml: "this is needed."
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {children && <div className='absolute top-2 right-2 flex items-center gap-2'>{children}</div>}
          </div>
        ) : (
          // Streaming placeholder / highlight pending: same geometry (padding,
          // font size, scroll) as the highlighted block, zero Shiki cost.
          <div className='relative'>
            <pre className='m-0 overflow-auto bg-background p-4 text-sm text-foreground'>
              <code className='font-mono text-sm whitespace-pre'>{code}</code>
            </pre>
            {children && <div className='absolute top-2 right-2 flex items-center gap-2'>{children}</div>}
          </div>
        )}
      </div>
    </CodeBlockContext.Provider>
  );
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
  code: string;
};

export const CodeBlockCopyButton = ({ onCopy, onError, timeout = 2000, children, className, code, ...props }: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = async () => {
    if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
      onError?.(new Error('Clipboard API not available'));
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      onCopy?.();
      setTimeout(() => setIsCopied(false), timeout);
    } catch (error) {
      onError?.(error as Error);
    }
  };

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <Button className={cn('shrink-0', className)} onClick={copyToClipboard} size='icon' variant='ghost' {...props}>
      {children ?? <Icon size={14} />}
    </Button>
  );
};
