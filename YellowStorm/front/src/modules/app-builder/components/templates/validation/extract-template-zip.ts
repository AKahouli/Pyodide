import { unzip } from 'fflate';
import type { VfsFiles } from '@/modules/app-builder-studio/runtime/RevisionHydrator';
import { isTextSourcePath } from '@/modules/app-builder-studio/utils/app-source';

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git']);
const EXCLUDED_BASENAMES = new Set(['manifest.json', 'README.md', 'package-lock.json']);

interface ArchiveEntry {
  path: string;
  data: Uint8Array;
}

function stripSingleRootPrefix(files: ArchiveEntry[]): ArchiveEntry[] {
  if (files.length === 0) return files;

  const roots = new Set(files.map((file) => file.path.split('/')[0]));
  if (roots.size !== 1) return files;

  const prefix = [...roots][0]!;
  if (!files.every((file) => file.path.startsWith(`${prefix}/`))) return files;

  const stripped = files.map((file) => ({
    ...file,
    path: file.path.slice(prefix.length + 1),
  }));

  if (
    !stripped.some(
      (file) =>
        !file.path.includes('/') &&
        (file.path === 'package.json' ||
          file.path === 'index.html' ||
          /^vite\.config\.[cm]?[jt]s$/.test(file.path)),
    )
  ) {
    return files;
  }

  return stripped;
}

/**
 * Expand a template ZIP in the browser for local validation (no Ceph / backend session).
 * Mirrors backend `extractTemplateArchive` exclusions and root-folder stripping.
 */
export async function extractTemplateZipFromFile(file: File): Promise<VfsFiles> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const unzipped = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(buffer, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  const raw: ArchiveEntry[] = [];
  for (const [entryName, data] of Object.entries(unzipped)) {
    const path = entryName.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.endsWith('/') || path.includes('..') || path.includes('\0')) continue;
    const parts = path.split('/');
    if (parts.some((part) => EXCLUDED_DIRS.has(part))) continue;
    const baseName = parts[parts.length - 1]!;
    if (EXCLUDED_BASENAMES.has(baseName) || baseName.endsWith('.map')) continue;
    raw.push({ path, data });
  }

  if (raw.length === 0) {
    throw new Error('The template archive contains no shippable files.');
  }

  const files = stripSingleRootPrefix(raw).sort((a, b) => a.path.localeCompare(b.path));
  const vfs: VfsFiles = {};
  for (const { path, data } of files) {
    const vfsPath = path.startsWith('/') ? path : `/${path}`;
    if (isTextSourcePath(path)) {
      vfs[vfsPath] = new TextDecoder().decode(data);
    } else {
      vfs[vfsPath] = data;
    }
  }

  if (typeof vfs['/package.json'] !== 'string') {
    throw new Error('The template archive must include a package.json at the project root.');
  }

  return vfs;
}
