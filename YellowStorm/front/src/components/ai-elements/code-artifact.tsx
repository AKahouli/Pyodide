'use client';

import { cn } from '@/lib/utils';
import { downloadCode } from '@/lib/download';
import { Artifact, ArtifactHeader, ArtifactTitle, ArtifactActions, ArtifactAction, ArtifactContent } from '@/components/ai-elements/artifact';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import { Copy, FileCode2, Download } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import type { BundledLanguage } from 'shiki';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useModuleTranslation } from '@/modules/localization';

// Map common language aliases to their display names
const languageDisplayNames: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  ruby: 'Ruby',
  go: 'Go',
  rust: 'Rust',
  rs: 'Rust',
  cpp: 'C++',
  'c++': 'C++',
  c: 'C',
  java: 'Java',
  kotlin: 'Kotlin',
  kt: 'Kotlin',
  swift: 'Swift',
  php: 'PHP',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'Sass',
  less: 'Less',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  xml: 'XML',
  sql: 'SQL',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  md: 'Markdown',
  markdown: 'Markdown',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  powershell: 'PowerShell',
  ps1: 'PowerShell',
  dockerfile: 'Dockerfile',
  docker: 'Dockerfile',
  plaintext: 'Plain Text',
  text: 'Plain Text',
};

export type CodeArtifactProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language?: BundledLanguage;
  filename?: string;
  showLineNumbers?: boolean;
  /** Forwarded to CodeBlock: plain text while streaming, Shiki once finalized. */
  isStreaming?: boolean;
};

/**
 * CodeArtifact - A code block displayed as an artifact with header, language tag, and copy button
 */
export const CodeArtifact = ({ code, language = 'plaintext' as BundledLanguage, filename, showLineNumbers = false, isStreaming = false, className, ...props }: CodeArtifactProps) => {
  const { t: tCommon } = useModuleTranslation('common');
  const displayLanguage = languageDisplayNames[language] || language.toUpperCase();

  return (
    <Artifact className={cn('my-2 max-w-full', className)} {...props}>
      <ArtifactHeader className='py-2 px-3'>
        <div className='flex items-center gap-2 min-w-0'>
          <FileCode2 className='h-4 w-4 shrink-0 text-muted-foreground' />
          <div className='flex flex-col min-w-0'>
            {filename && <ArtifactTitle className='truncate text-xs'>{filename}</ArtifactTitle>}
            <span className='text-[10px] text-muted-foreground uppercase tracking-wide'>{displayLanguage}</span>
          </div>
        </div>
        <ArtifactActions>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <ArtifactAction className='h-7 w-7' onClick={() => downloadCode({ content: code, filename, language })}>
                  <Download className='h-4 w-4' />
                </ArtifactAction>
              </TooltipTrigger>
              <TooltipContent>
                <p>{tCommon('actionDownload')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <CodeBlockCopyButton className='h-7 w-7' code={code} />
        </ArtifactActions>
      </ArtifactHeader>
      <ArtifactContent className='p-0 overflow-hidden'>
        <CodeBlock code={code} language={language} showLineNumbers={showLineNumbers} isStreaming={isStreaming} className='border-0 rounded-none' />
      </ArtifactContent>
    </Artifact>
  );
};

// Regex to match markdown code blocks with optional language and filename
// Supports: ```language filename.ext or ```language:filename.ext or just ```language
const CODE_BLOCK_REGEX = /```(\w+)?(?:[:\s]+([^\n]+))?\n([\s\S]*?)```/g;

export interface ParsedMessagePart {
  type: 'text' | 'code';
  content: string;
  language?: string;
  filename?: string;
}

/**
 * Parse a message string and extract code blocks
 */
export function parseMessageContent(content: string): ParsedMessagePart[] {
  const parts: ParsedMessagePart[] = [];
  let lastIndex = 0;

  // Reset regex state
  CODE_BLOCK_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
    // Add text before the code block
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) {
        parts.push({ type: 'text', content: textBefore });
      }
    }

    // Add the code block
    const language = match[1] || 'plaintext';
    const filename = match[2]?.trim();
    const code = match[3].trim();

    parts.push({ type: 'code', content: code, language, filename });

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining text after the last code block
  if (lastIndex < content.length) {
    const remainingText = content.slice(lastIndex).trim();
    if (remainingText) {
      parts.push({ type: 'text', content: remainingText });
    }
  }

  // If no code blocks were found, return the whole content as text
  if (parts.length === 0) {
    parts.push({ type: 'text', content: content });
  }

  return parts;
}
