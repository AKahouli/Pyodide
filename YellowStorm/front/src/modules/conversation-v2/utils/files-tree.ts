import type { FilesTreeNode } from '../types';

/**
 * Manus historically used ``path.lstrip("./")`` which strips ANY leading
 * ``.`` / ``/`` chars — so ``.gitignore`` became ``gitignore``. Restore the
 * leading dot for known config basenames so Ceph keys still match.
 */
const MANGLED_DOTFILE =
  /^(gitignore|gitattributes|dockerignore|npmrc|prettierrc|eslintrc(\..+)?|editorconfig|env(\..+)?|htaccess)$/i;

export function restoreMangledDotfilePath(path: string): string {
  const normalized = path.replace(/^\/+/, '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  const base = parts[parts.length - 1] ?? '';
  if (!base || base.startsWith('.') || !MANGLED_DOTFILE.test(base)) {
    return normalized;
  }
  parts[parts.length - 1] = `.${base}`;
  return parts.join('/');
}

/** Flatten a nested Manus files_tree into relative file paths. */
export function flattenFilesTree(
  tree: FilesTreeNode | null | undefined,
): Array<{ path: string; size: number }> {
  if (!tree) return [];
  const out: Array<{ path: string; size: number }> = [];

  const walk = (node: FilesTreeNode) => {
    if (node.type === 'file' && node.path) {
      out.push({
        path: restoreMangledDotfilePath(node.path),
        size: node.size ?? 0,
      });
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };

  walk(tree);
  return out;
}
