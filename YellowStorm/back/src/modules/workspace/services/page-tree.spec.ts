import { buildPageTree } from './page-tree';

describe('buildPageTree', () => {
  it('nests pages by URL path hierarchy (path trie), deterministic order', () => {
    const pages = [
      { url: 'https://ex.com/docs/guide/intro' },
      { url: 'https://ex.com/docs' },
      { url: 'https://ex.com/docs/guide' },
      { url: 'https://ex.com/' },
    ];
    const tree = buildPageTree(pages, new Set());
    // Top level: the site root page ('/') plus the top-level 'docs' segment.
    const root = tree.find((n) => n.path === '/')!;
    expect(root).toBeDefined();
    expect(root.name).toBe('ex.com'); // root labelled by host
    const docs = tree.find((n) => n.path === '/docs')!;
    expect(docs).toBeDefined();
    expect(docs.name).toBe('docs');
    const guide = docs.children.find((n) => n.path === '/docs/guide')!;
    expect(guide.name).toBe('guide');
    const intro = guide.children.find((n) => n.path === '/docs/guide/intro')!;
    expect(intro.name).toBe('intro');
  });

  it('creates non-selectable synthetic group nodes for shared prefixes', () => {
    // /page/a and /page/b exist, but /page itself does not.
    const tree = buildPageTree(
      [{ url: 'https://ex.com/page/a' }, { url: 'https://ex.com/page/b' }],
      new Set(),
    );
    const group = tree.find((n) => n.path === '/page')!;
    expect(group).toBeDefined();
    expect(group.name).toBe('page');
    expect(group.url).toBe(''); // synthetic group -> not selectable
    const childUrls = group.children.map((c) => c.url).sort();
    expect(childUrls).toEqual(['https://ex.com/page/a', 'https://ex.com/page/b']);
  });

  it('marks alreadyIndexed from the provided set', () => {
    const tree = buildPageTree(
      [{ url: 'https://ex.com/a' }, { url: 'https://ex.com/b' }],
      new Set(['https://ex.com/a']),
    );
    const flat: Record<string, boolean> = {};
    const walk = (ns: ReturnType<typeof buildPageTree>) =>
      ns.forEach((n) => { if (n.url) flat[n.url] = n.alreadyIndexed; walk(n.children); });
    walk(tree);
    expect(flat['https://ex.com/a']).toBe(true);
    expect(flat['https://ex.com/b']).toBe(false);
  });
});
