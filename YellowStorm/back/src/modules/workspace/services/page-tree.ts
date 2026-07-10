import { DiscoveredPage } from './website-crawler.service';

export interface PageNode {
  /** Real page URL, or '' for a synthetic category/group node (not indexable). */
  url: string;
  title?: string;
  /** Full path, e.g. '/docs/guide'. */
  path: string;
  /** Display label: the last path segment, or the host for the site root page. */
  name: string;
  alreadyIndexed: boolean;
  children: PageNode[];
}

interface TrieNode {
  segment: string;
  path: string;
  page?: DiscoveredPage;
  children: Map<string, TrieNode>;
}

/**
 * Build a tree of pages by URL path hierarchy, as a path trie. Every path
 * segment becomes a node, so pages that share a prefix (e.g. many `/docs/…`
 * pages) nest under a single `docs` group even when `/docs` itself was not a
 * discovered page. Synthetic group nodes have `url === ''` and are not
 * selectable; only real discovered pages carry a `url`. Deterministic order
 * (sorted by segment).
 */
export function buildPageTree(pages: DiscoveredPage[], indexedUrls: Set<string>): PageNode[] {
  const roots = new Map<string, TrieNode>();
  let rootPage: { page: DiscoveredPage; host: string } | undefined;

  for (const page of pages) {
    let pathname = '/';
    let host = '';
    try {
      const u = new URL(page.url);
      pathname = u.pathname || '/';
      host = u.host;
    } catch {
      /* keep defaults */
    }
    const segments = pathname.split('/').filter(Boolean);

    if (segments.length === 0) {
      // Site root / homepage — a top-level real page labelled by host.
      rootPage = { page, host };
      continue;
    }

    let level = roots;
    let accPath = '';
    let node: TrieNode | undefined;
    for (const seg of segments) {
      accPath += `/${seg}`;
      node = level.get(seg);
      if (!node) {
        node = { segment: seg, path: accPath, children: new Map() };
        level.set(seg, node);
      }
      level = node.children;
    }
    if (node) node.page = page;
  }

  const toPageNode = (t: TrieNode): PageNode => {
    const url = t.page?.url ?? '';
    return {
      url,
      title: t.page?.title,
      path: t.path,
      name: t.segment,
      alreadyIndexed: url ? indexedUrls.has(url) : false,
      children: [...t.children.values()]
        .sort((a, b) => a.segment.localeCompare(b.segment))
        .map(toPageNode),
    };
  };

  const result: PageNode[] = [];
  if (rootPage) {
    result.push({
      url: rootPage.page.url,
      title: rootPage.page.title,
      path: '/',
      name: rootPage.host || rootPage.page.url,
      alreadyIndexed: indexedUrls.has(rootPage.page.url),
      children: [],
    });
  }
  result.push(
    ...[...roots.values()]
      .sort((a, b) => a.segment.localeCompare(b.segment))
      .map(toPageNode),
  );
  return result;
}
