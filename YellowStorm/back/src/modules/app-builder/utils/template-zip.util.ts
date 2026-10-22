import AdmZip = require('adm-zip');
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  TEMPLATE_MAX_ARCHIVE_FILES,
  TEMPLATE_MAX_UNCOMPRESSED_BYTES,
} from '../constants/template-catalog.constants';

export interface TemplateArchiveFile {
  path: string;
  data: Buffer;
}

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git']);
const EXCLUDED_BASENAMES = new Set(['manifest.json', 'README.md', 'package-lock.json']);

/** Extensions treated as text when returning a normalized tree for NodePod preview. */
const TEXT_SOURCE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|json|md|mdx|css|scss|sass|less|html?|svg|txt|yml|yaml|toml|env|gitignore|npmrc|prettierrc|eslintrc)$/i;

export function isTextSourcePath(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return TEXT_SOURCE_EXT.test(path) || name === 'Dockerfile' || name.startsWith('.');
}

/**
 * Extract the shippable source files from a template ZIP, mirroring the
 * starter publish script's exclusions (build output, locks, source maps).
 * Rejects empty or oversized archives as ERR_3804.
 *
 * GitHub-style archives wrap the project in a single top folder
 * (`material-kit-react-main/...`). That prefix is stripped so Vite, the
 * Platform Kit and NodePod preview all see a flat React project root.
 */
export function extractTemplateArchive(buffer: Buffer): TemplateArchiveFile[] {
  let archive: AdmZip;
  try {
    archive = new AdmZip(buffer);
  } catch {
    throw new BadRequestException(
      ErrorCode.APP_BUILDER_TEMPLATE_ZIP_INVALID,
      'The template source is not a valid ZIP archive.',
    );
  }

  const files: TemplateArchiveFile[] = [];
  let totalBytes = 0;

  for (const entry of archive.getEntries()) {
    if (entry.isDirectory) continue;
    const path = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.includes('..') || path.includes('\0')) continue;
    const parts = path.split('/');
    if (parts.some((part) => EXCLUDED_DIRS.has(part))) continue;
    const baseName = parts[parts.length - 1];
    if (EXCLUDED_BASENAMES.has(baseName) || baseName.endsWith('.map')) continue;

    const data = entry.getData();
    totalBytes += data.length;
    if (
      files.length + 1 > TEMPLATE_MAX_ARCHIVE_FILES ||
      totalBytes > TEMPLATE_MAX_UNCOMPRESSED_BYTES
    ) {
      throw new BadRequestException(
        ErrorCode.APP_BUILDER_TEMPLATE_ZIP_INVALID,
        'The template archive is too large.',
      );
    }
    files.push({ path, data });
  }

  if (files.length === 0) {
    throw new BadRequestException(
      ErrorCode.APP_BUILDER_TEMPLATE_ZIP_INVALID,
      'The template archive contains no shippable files.',
    );
  }

  return stripSingleRootPrefix(files).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * When every path is under one shared directory (and none sit at the ZIP
 * root), drop that directory so the project root matches a Vite workspace.
 * Only strips when the flattened root still looks like a project (package.json,
 * index.html, or vite.config.*) — never peel a real `src/` folder away.
 */
export function stripSingleRootPrefix(files: TemplateArchiveFile[]): TemplateArchiveFile[] {
  if (files.length === 0) return files;

  const roots = new Set(files.map((file) => file.path.split('/')[0]));
  if (roots.size !== 1) return files;

  const prefix = [...roots][0];
  // A lone root file (`package.json`) is already the project root.
  if (!files.every((file) => file.path.startsWith(`${prefix}/`))) return files;

  const stripped = files.map((file) => ({
    ...file,
    path: file.path.slice(prefix.length + 1),
  }));

  if (!stripped.some((file) => isProjectRootMarker(file.path))) {
    return files;
  }

  return stripped;
}

function isProjectRootMarker(path: string): boolean {
  if (path.includes('/')) return false;
  return (
    path === 'package.json' ||
    path === 'index.html' ||
    /^vite\.config\.[cm]?[jt]s$/.test(path)
  );
}
