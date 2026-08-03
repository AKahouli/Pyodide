import type { FilesTreeNode } from '../types';

/** Flatten a nested Manus files_tree into relative file paths. */
export function flattenFilesTree(
  tree: FilesTreeNode | null | undefined,
): Array<{ path: string; size: number }> {
  if (!tree) return [];
  const out: Array<{ path: string; size: number }> = [];

  const walk = (node: FilesTreeNode) => {
    if (node.type === 'file' && node.path) {
      out.push({ path: node.path.replace(/^\/+/, ''), size: node.size ?? 0 });
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };

  walk(tree);
  return out;
}
