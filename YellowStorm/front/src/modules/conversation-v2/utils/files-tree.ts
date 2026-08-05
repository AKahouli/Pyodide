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

/** Count file nodes in a tree. */
export function countFilesInTree(tree: FilesTreeNode | null | undefined): number {
  return flattenFilesTree(tree).length;
}

/**
 * Prune a tree to nodes matching `query` (name or path), keeping ancestor folders.
 */
export function filterFilesTree(
  tree: FilesTreeNode | null | undefined,
  query: string,
): FilesTreeNode | null {
  if (!tree) return null;
  const q = query.trim().toLowerCase();
  if (!q) return tree;

  const matchNode = (node: FilesTreeNode): boolean => {
    const path = (node.path ?? node.name).toLowerCase();
    return node.name.toLowerCase().includes(q) || path.includes(q);
  };

  const walk = (node: FilesTreeNode): FilesTreeNode | null => {
    if (node.type === 'file') {
      return matchNode(node) ? node : null;
    }
    const children = (node.children ?? [])
      .map(walk)
      .filter((child): child is FilesTreeNode => child != null);
    if (children.length > 0) {
      return { ...node, children };
    }
    return matchNode(node) ? { ...node, children: [] } : null;
  };

  return walk(tree);
}
