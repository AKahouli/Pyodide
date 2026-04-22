import { describe, expect, it } from 'vitest';
import { rehypeCitationMarkers } from './rehype-citation-markers';

// Minimal HAST node helpers
const text = (value: string) => ({ type: 'text' as const, value });
const element = (tagName: string, children: any[]) => ({
  type: 'element' as const,
  tagName,
  properties: {},
  children,
});

function run(tree: any) {
  rehypeCitationMarkers()(tree);
  return tree;
}

describe('rehypeCitationMarkers', () => {
  it('splits a single [1] in text into text + cite + text', () => {
    const tree = element('p', [text('Hello [1] world')]);
    run(tree);

    expect(tree.children).toHaveLength(3);
    expect(tree.children[0]).toEqual({ type: 'text', value: 'Hello ' });
    expect(tree.children[1]).toMatchObject({
      type: 'element',
      tagName: 'cite',
      properties: { 'data-citation-ref': '1' },
    });
    expect(tree.children[2]).toEqual({ type: 'text', value: ' world' });
  });

  it('handles multiple citations [1] and [2]', () => {
    const tree = element('p', [text('See [1] and [2] here')]);
    run(tree);

    const cites = tree.children.filter((n: any) => n.type === 'element' && n.tagName === 'cite');
    expect(cites).toHaveLength(2);
    expect(cites[0].properties['data-citation-ref']).toBe('1');
    expect(cites[1].properties['data-citation-ref']).toBe('2');
  });

  it('leaves tree unchanged when no citations present', () => {
    const tree = element('p', [text('No citations here')]);
    const original = JSON.parse(JSON.stringify(tree));
    run(tree);

    expect(tree).toEqual(original);
  });

  it('does not produce empty leading text node for citation at start', () => {
    const tree = element('p', [text('[1] starts here')]);
    run(tree);

    expect(tree.children[0].type).toBe('element');
    expect(tree.children[0].tagName).toBe('cite');
    expect(tree.children).toHaveLength(2);
  });

  it('does not produce empty trailing text node for citation at end', () => {
    const tree = element('p', [text('ends here [1]')]);
    run(tree);

    const last = tree.children[tree.children.length - 1];
    expect(last.type).toBe('element');
    expect(last.tagName).toBe('cite');
  });

  it('handles large citation numbers like [999]', () => {
    const tree = element('p', [text('ref [999]')]);
    run(tree);

    const cite = tree.children.find((n: any) => n.tagName === 'cite');
    expect(cite.properties['data-citation-ref']).toBe('999');
  });

  it('ignores non-numeric brackets like [abc]', () => {
    const tree = element('p', [text('see [abc] here')]);
    const original = JSON.parse(JSON.stringify(tree));
    run(tree);

    expect(tree).toEqual(original);
  });

  it('handles text containing only [1]', () => {
    const tree = element('p', [text('[1]')]);
    run(tree);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toMatchObject({
      type: 'element',
      tagName: 'cite',
      properties: { 'data-citation-ref': '1' },
    });
  });

  it('recurses into nested paragraph elements', () => {
    const tree = element('div', [element('p', [text('nested [1]')])]);
    run(tree);

    const p = tree.children[0];
    const cite = p.children.find((n: any) => n.tagName === 'cite');
    expect(cite).toBeDefined();
    expect(cite.properties['data-citation-ref']).toBe('1');
  });

  it('skips nodes without children array', () => {
    // A raw node with no children property is left untouched
    const raw = { type: 'raw', value: 'some [1] raw' };
    const tree = element('div', [raw, text('normal [2]')]);
    run(tree);

    // raw node unchanged (no children to traverse), sibling text was split
    expect(tree.children[0]).toBe(raw);
    // After split: raw + text("normal ") + cite(2)
    expect(tree.children).toHaveLength(3);
    expect(tree.children[2]).toMatchObject({ type: 'element', tagName: 'cite' });
  });
});