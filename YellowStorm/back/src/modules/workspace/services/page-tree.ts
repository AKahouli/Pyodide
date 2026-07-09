import { DiscoveredPage } from './website-crawler.service';

export interface PageNode {
  url: string;
  title?: string;
  path: string;
  alreadyIndexed: boolean;
  children: PageNode[];
}

/**
 * Build a tree of pages by URL path hierarchy. Each page nests under the
 * deepest already-present ancestor by path segments; pages with no present
 * ancestor attach at the top level. Deterministic (sorted by path).
 */
export function buildPageTree(pages: DiscoveredPage[], indexedUrls: Set<string>): PageNode[] {
  const nodes: PageNode[] = pages
    .map((p) => {
      let path = '/';
      try { path = new URL(p.url).pathname || '/'; } catch { /* keep '/' */ }
      return { url: p.url, title: p.title, path, alreadyIndexed: indexedUrls.has(p.url), children: [] as PageNode[] };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const byPath = new Map<string, PageNode>();
  for (const n of nodes) if (!byPath.has(n.path)) byPath.set(n.path, n);

  const roots: PageNode[] = [];
  for (const n of nodes) {
    const parent = findParent(n.path, byPath);
    if (parent && parent !== n) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

function findParent(path: string, byPath: Map<string, PageNode>): PageNode | undefined {
  const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 1; i--) {
    const ancestor = '/' + segments.slice(0, i).join('/');
    const hit = byPath.get(ancestor);
    if (hit) return hit;
  }
  // Fall back to the root '/' if present and this isn't itself '/'.
  if (path !== '/') return byPath.get('/');
  return undefined;
}
