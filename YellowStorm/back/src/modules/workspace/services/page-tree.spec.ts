import { buildPageTree } from './page-tree';

describe('buildPageTree', () => {
  it('nests pages by URL path hierarchy, deterministic order', () => {
    const pages = [
      { url: 'https://ex.com/docs/guide/intro' },
      { url: 'https://ex.com/docs' },
      { url: 'https://ex.com/docs/guide' },
      { url: 'https://ex.com/' },
    ];
    const tree = buildPageTree(pages, new Set());
    // Root '/' at top; '/docs' nested under it; '/docs/guide' under '/docs'; '/docs/guide/intro' under that.
    const root = tree.find((n) => n.path === '/')!;
    expect(root).toBeDefined();
    const docs = root.children.find((n) => n.path === '/docs')!;
    expect(docs).toBeDefined();
    const guide = docs.children.find((n) => n.path === '/docs/guide')!;
    expect(guide.children.some((n) => n.path === '/docs/guide/intro')).toBe(true);
  });

  it('marks alreadyIndexed from the provided set', () => {
    const tree = buildPageTree(
      [{ url: 'https://ex.com/a' }, { url: 'https://ex.com/b' }],
      new Set(['https://ex.com/a']),
    );
    const flat: Record<string, boolean> = {};
    const walk = (ns: any[]) => ns.forEach((n) => { flat[n.url] = n.alreadyIndexed; walk(n.children); });
    walk(tree);
    expect(flat['https://ex.com/a']).toBe(true);
    expect(flat['https://ex.com/b']).toBe(false);
  });
});
