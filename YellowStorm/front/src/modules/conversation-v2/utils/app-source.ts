import type { BundledLanguage } from 'shiki';
import type { LucideIcon } from 'lucide-react';
import {
  FileCodeIcon,
  FileIcon,
  FileJsonIcon,
  FileTextIcon,
  ImageIcon,
} from 'lucide-react';

/** Extensions treated as text when hydrating the Nodepod VFS / source viewer. */
const TEXT_SOURCE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|json|md|mdx|css|scss|sass|less|html?|svg|txt|yml|yaml|toml|env|gitignore|npmrc|prettierrc|eslintrc)$/i;

export function isTextSourcePath(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return TEXT_SOURCE_EXT.test(path) || name === 'Dockerfile' || name.startsWith('.');
}

export function formatBytes(size?: number | null): string {
  if (size == null || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function languageFromPath(path: string): BundledLanguage {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, BundledLanguage> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    svg: 'xml',
  };
  return map[ext] ?? 'plaintext';
}

export function fileIconForName(name: string): LucideIcon {
  const lower = name.toLowerCase();
  if (/\.(tsx?|jsx?|mjs|cjs)$/.test(lower)) return FileCodeIcon;
  if (/\.json$/.test(lower)) return FileJsonIcon;
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/.test(lower)) return ImageIcon;
  if (/\.(md|txt|css|scss|html?|yml|yaml|toml)$/.test(lower)) return FileTextIcon;
  return FileIcon;
}
