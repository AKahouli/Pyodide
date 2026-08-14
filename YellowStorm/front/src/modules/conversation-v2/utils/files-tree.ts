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

type LegacyTreeNode = {
  name?: string;
  type?: string;
  path?: string;
  size?: number;
  children?: LegacyTreeNode[];
};

/** Build a Manus-shaped tree from absolute Nodepod VFS paths (`/src/App.jsx`). */
export function buildFilesTreeFromVfsPaths(vfsPaths: string[]): FilesTreeNode {
  const root: FilesTreeNode = { name: '', type: 'directory', children: [] };

  for (const vfsPath of [...vfsPaths].sort()) {
    const rel = vfsPath.replace(/^\/+/, '');
    if (!rel) continue;
    const segments = rel.split('/').filter(Boolean);
    let cursor = root;
    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      cursor.children ??= [];
      let next = cursor.children.find((child) => child.name === segment);
      if (!next) {
        const relPath = segments.slice(0, index + 1).join('/');
        next = isLeaf
          ? { name: segment, type: 'file', path: relPath }
          : { name: segment, type: 'directory', children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    });
  }

  return root;
}

/** Coerce runtime/finalize trees (`dir` + missing paths) into Manus display shape. */
export function normalizeFilesTree(tree: unknown): FilesTreeNode | null {
  if (!tree || typeof tree !== 'object') return null;

  const normalizeNode = (node: LegacyTreeNode, parentRel: string): FilesTreeNode => {
    const rawName = String(node.name ?? '');
    const name = rawName === '/' ? '' : rawName;
    const isFile = node.type === 'file';
    if (isFile) {
      const path = (node.path ?? (parentRel ? `${parentRel}/${name}` : name)).replace(/^\/+/, '');
      return {
        name: name || path.split('/').pop() || path,
        type: 'file',
        path,
        ...(node.size != null ? { size: node.size } : {}),
      };
    }
    const rel = parentRel ? (name ? `${parentRel}/${name}` : parentRel) : name;
    const children = (node.children ?? []).map((child) => normalizeNode(child, rel));
    return { name, type: 'directory', children };
  };

  const normalized = normalizeNode(tree as LegacyTreeNode, '');
  return countFilesInTree(normalized) > 0 ? normalized : null;
}

/**
 * Resolve the tree shown in split view: prefer SSE metadata, else live Nodepod files.
 */
export function resolveSourceFilesTree(
  tree: FilesTreeNode | null | undefined,
  vfsFiles: Record<string, string | Uint8Array> | null | undefined,
): FilesTreeNode | null {
  // Prefer the live Nodepod VFS so split view tracks write/apply_patch mutations.
  if (vfsFiles && Object.keys(vfsFiles).length > 0) {
    return buildFilesTreeFromVfsPaths(Object.keys(vfsFiles));
  }
  const normalized = normalizeFilesTree(tree);
  if (normalized && countFilesInTree(normalized) > 0) return normalized;
  return null;
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
