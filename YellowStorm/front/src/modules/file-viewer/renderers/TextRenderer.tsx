/**
 * Text Renderer
 * Displays text files with syntax highlighting via shiki
 */

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { BundledLanguage, ShikiTransformer } from 'shiki';
import { FileWarning, X, RotateCw, Loader2, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { useFileViewerStore } from '../store';
import type { RendererProps } from '../types';
import { useModuleTranslation } from '@/modules/localization';

type LoadState = 'loading' | 'ready' | 'error';

interface TextRendererInternalProps extends RendererProps {
  registryRef?: React.MutableRefObject<Map<string, unknown>>;
}

const MIME_TO_LANGUAGE: Record<string, BundledLanguage> = {
  'text/markdown': 'markdown',
  'text/csv': 'csv',
  'text/css': 'css',
  'text/html': 'html',
  'text/xml': 'xml',
  'text/yaml': 'yaml',
  'text/javascript': 'javascript',
  'text/typescript': 'typescript',
  'text/x-python': 'python',
  'application/json': 'json',
  'application/xml': 'xml',
  'application/javascript': 'javascript',
  'application/typescript': 'typescript',
};

const EXT_TO_LANGUAGE: Record<string, BundledLanguage> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  md: 'markdown',
  mdx: 'mdx',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  env: 'dotenv',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  json: 'json',
  jsonc: 'jsonc',
  xml: 'xml',
  svg: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  csv: 'csv',
  log: 'log',
};

// Shiki loads only when a highlighted file is actually opened (Phase 7 lazy boundary).
let shikiModulePromise: Promise<typeof import('shiki')> | null = null;
function loadShiki(): Promise<typeof import('shiki')> {
  shikiModulePromise ??= import('shiki');
  return shikiModulePromise;
}

const lineNumberTransformer: ShikiTransformer = {
  name: 'line-numbers',
  line(node, line) {
    node.children.unshift({
      type: 'element',
      tagName: 'span',
      properties: {
        className: [
          'inline-block',
          'min-w-[3ch]',
          'mr-6',
          'text-right',
          'select-none',
          'text-muted-foreground/50',
        ],
      },
      children: [{ type: 'text', value: String(line) }],
    });
  },
};

/** Guess shiki language from MIME type and file extension. Returns null for plain text. */
function getLanguage(mimeType: string, fileName: string): BundledLanguage | null {
  if (MIME_TO_LANGUAGE[mimeType]) return MIME_TO_LANGUAGE[mimeType];

  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANGUAGE[ext] ?? null;
}

/** Build plain-text HTML with line numbers (no syntax highlighting) */
function plainTextToHtml(text: string): string {
  const lines = text.split('\n');
  const escaped = lines.map((line, i) => {
    const num = i + 1;
    const escapedLine = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<span class="inline-block min-w-[3ch] mr-6 text-right select-none text-muted-foreground/50">${num}</span>${escapedLine}`;
  });
  return `<pre><code>${escaped.join('\n')}</code></pre>`;
}

export function TextRenderer({ tab }: TextRendererInternalProps) {
  const { theme } = useContext(ThemeProviderContext);
  const closeTab = useFileViewerStore((s) => s.closeTab);
  const refreshTabUrl = useFileViewerStore((s) => s.refreshTabUrl);
  const { t } = useModuleTranslation('file-viewer');

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [lightHtml, setLightHtml] = useState('');
  const [darkHtml, setDarkHtml] = useState('');
  const [rawText, setRawText] = useState('');
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const fetchedUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (fetchedUrl.current === tab.url) return;

      setLoadState('loading');

      try {
        const res = await fetch(tab.url);
        if (cancelled) return;

        if (!res.ok) {
          setErrorMessage(res.status === 404 ? t('text.error.notFound') : t('text.error.http', { status: res.status }));
          setLoadState('error');
          return;
        }

        const text = await res.text();
        if (cancelled) return;

        setRawText(text);
        fetchedUrl.current = tab.url;

        const lang = getLanguage(tab.mimeType, tab.fileName);

        if (lang) {
          // Syntax-highlighted rendering
          const { codeToHtml } = await loadShiki();
          const [light, dark] = await Promise.all([
            codeToHtml(text, {
              lang,
              theme: 'one-light',
              transformers: [lineNumberTransformer],
            }),
            codeToHtml(text, {
              lang,
              theme: 'one-dark-pro',
              transformers: [lineNumberTransformer],
            }),
          ]);

          if (cancelled) return;

          setLightHtml(light);
          setDarkHtml(dark);
        } else {
          // Plain text — no highlighting, just line numbers
          const html = plainTextToHtml(text);
          setLightHtml(html);
          setDarkHtml(html);
        }

        setLoadState('ready');
      } catch {
        if (cancelled) return;
        setErrorMessage(t('text.error.network'));
        setLoadState('error');
      }
    }

    load();
    return () => { cancelled = true; };
  }, [tab.url, tab.mimeType, tab.fileName, t]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [rawText]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      await refreshTabUrl(tab.id);
      fetchedUrl.current = null;
    } finally {
      setRetrying(false);
    }
  }, [tab.id, refreshTabUrl]);

  if (loadState === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center p-6">
          <div className="rounded-full bg-destructive/10 p-4">
            <FileWarning className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{t('text.error.title')}</h3>
            <p className="text-xs text-muted-foreground">{errorMessage}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
              <RotateCw className={`h-3.5 w-3.5 mr-1.5 ${retrying ? 'animate-spin' : ''}`} />
              {t('actions.retry')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => closeTab(tab.id)}>
              <X className="h-3.5 w-3.5 mr-1.5" />
              {t('actions.closeTab')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col">
      {/* Copy button */}
      <div className="absolute top-2 right-4 z-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 bg-background/80 backdrop-blur-sm border shadow-sm"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Highlighted code */}
      <div className="flex-1 overflow-auto">
        <div
          className="dark:hidden [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-sm [&>pre]:min-h-full [&_code]:font-mono [&_code]:text-sm"
          dangerouslySetInnerHTML={{ __html: lightHtml }}
        />
        <div
          className="hidden dark:block [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-sm [&>pre]:min-h-full [&_code]:font-mono [&_code]:text-sm"
          dangerouslySetInnerHTML={{ __html: darkHtml }}
        />
      </div>
    </div>
  );
}
