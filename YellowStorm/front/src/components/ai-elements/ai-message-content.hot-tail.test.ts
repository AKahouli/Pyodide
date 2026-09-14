import { describe, expect, it } from 'vitest';
import { splitMarkdownAtSafeBoundary } from './ai-message-content';

const paragraph = 'Paragraph one with some prose.\n\n';
const longContent = paragraph.repeat(120); // > HOT_TAIL_MIN_LENGTH

describe('splitMarkdownAtSafeBoundary', () => {
  it('does not split short content', () => {
    const { stable, tail } = splitMarkdownAtSafeBoundary('Short answer.');
    expect(stable).toBe('');
    expect(tail).toBe('Short answer.');
  });

  it('splits long content at the last blank line, keeping the partial block in the tail', () => {
    const content = longContent + 'Growing paragraph that is still streaming';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe(longContent);
    expect(tail).toBe('Growing paragraph that is still streaming');
    expect(stable + tail).toBe(content);
  });

  it('never splits inside an open fenced code block', () => {
    const intro = longContent;
    const content = intro + '```js\nconst a = 1;\n\nconst b = 2;\n';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe(intro);
    expect(tail).toBe('```js\nconst a = 1;\n\nconst b = 2;\n');
  });

  it('treats blank lines inside a closed fence as unsafe but after it as safe', () => {
    const base = longContent;
    const content = base + '```\ninner\n\nblank inside fence\n```\n\nAfter the fence tail';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    // The blank lines inside the fence are unsafe; the one AFTER the closing
    // fence is a real boundary and becomes the split point.
    expect(stable).toBe(base + '```\ninner\n\nblank inside fence\n```\n\n');
    expect(tail).toBe('After the fence tail');

    const completed = content + '\n\nNext paragraph';
    const closedSplit = splitMarkdownAtSafeBoundary(completed);
    // A later boundary supersedes it.
    expect(closedSplit.tail).toBe('Next paragraph');
  });

  it('keeps the split idempotent for identical content', () => {
    const first = splitMarkdownAtSafeBoundary(longContent + 'tail');
    const second = splitMarkdownAtSafeBoundary(longContent + 'tail');
    expect(first).toEqual(second);
  });
});

describe('splitMarkdownAtSafeBoundary fence/list rules', () => {
  it('only closes a fence on a run of the same char at least as long, without info string', () => {
    const base = 'Paragraph one with some prose.\n\n'.repeat(120);
    // A ``` line inside a ```` fence must NOT close the fence.
    const content = base + '````md\ninner\n``` not a close\nmore\n````\n\nAfter the fence';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe(base + '````md\ninner\n``` not a close\nmore\n````\n\n');
    expect(tail).toBe('After the fence');
  });

  it('does not split where the next non-blank line continues a list', () => {
    const base = 'Paragraph one with some prose.\n\n'.repeat(120);
    const content = base + '1. First item\n\n2. Second item\n\n3. Third item';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    // The boundary BEFORE the list is safe; the blank lines between list
    // items must not become boundaries (the list stays whole in the tail).
    expect(stable).toBe(base);
    expect(tail).toBe('1. First item\n\n2. Second item\n\n3. Third item');
  });

  it('does not split a loose list embedded in blockquote markers', () => {
    const base = 'Paragraph one with some prose.\n\n'.repeat(120);
    const content = base + '> 1. First item\n\n> 2. Second item\n\n> 3. Third item';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    // Quote markers must not hide the list continuation from the veto.
    expect(stable).toBe(base);
    expect(tail).toBe('> 1. First item\n\n> 2. Second item\n\n> 3. Third item');
  });

  it('does not split between quote lines that continue a list item', () => {
    const base = 'Paragraph one with some prose.\n\n'.repeat(120);
    const content = base + '1. Outer item\n   > quoted note\n\n   > more quote';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    // The blank line between the two quote lines sits inside the outer list
    // item's quoted content — splitting there would orphan the second quote.
    expect(stable).toBe(base);
    expect(tail).toBe('1. Outer item\n   > quoted note\n\n   > more quote');
  });

  it('still splits where a paragraph is followed by a quoted block', () => {
    const base = 'Paragraph one with some prose.\n\n'.repeat(120);
    const content = base + 'Closing paragraph\n\n> A fresh blockquote';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    // A blockquote STARTED after a paragraph is a new block — safe.
    expect(stable).toBe(base + 'Closing paragraph\n\n');
    expect(tail).toBe('> A fresh blockquote');
  });
});

describe('splitMarkdownAtSafeBoundary math blocks', () => {
  const base = 'Paragraph one with some prose.\n\n'.repeat(120);

  it('never splits inside a $$ display-math block containing blank lines', () => {
    const content = base + '$$\nE = mc^2\n\nV = W\n$$\n\nAfter the math';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe(base + '$$\nE = mc^2\n\nV = W\n$$\n\n');
    expect(tail).toBe('After the math');
  });

  it('keeps an unterminated $$ block in the tail while streaming', () => {
    const content = base + '$$\nE = mc^2\n\nV =';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe(base);
    expect(tail).toBe('$$\nE = mc^2\n\nV =');
  });

  it('treats a single-line $$x$$ as regular paragraph content', () => {
    const content = base + 'Inline display $$x^2$$ line\n\nAfter the paragraph';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe(base + 'Inline display $$x^2$$ line\n\n');
    expect(tail).toBe('After the paragraph');
  });

  it('tracks mid-line $$ openers and closers from normalized display spans', () => {
    // normalizeMathDelimiters can emit `$$` mid-line when `\[ ... \]` was
    // mid-paragraph; the splitter must still pair opener and closer.
    const content = base + 'Avant $$\nE = mc^2\n$$ apres\n\nAprès le math';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe(base + 'Avant $$\nE = mc^2\n$$ apres\n\n');
    expect(tail).toBe('Après le math');
  });
});

describe('splitMarkdownAtSafeBoundary reference definitions', () => {
  const base = 'Paragraph one with some prose.\n\n'.repeat(120);

  it('never splits when a link reference definition follows its use', () => {
    // Reference definitions are document-scoped: a boundary between the use
    // and its definition would break the link across the two parses.
    const content = base + 'See [User guide][guide].\n\n[guide]: /manual';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe('');
    expect(tail).toBe(content);
  });

  it('never splits when a link reference definition precedes its use', () => {
    const content = base + '[guide]: /manual\n\nSee [User guide][guide].';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe('');
    expect(tail).toBe(content);
  });

  it('never splits footnote definitions away from their references', () => {
    const content = base + 'A claim[^1].\n\n[^1]: The source note.';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe('');
    expect(tail).toBe(content);
  });

  it('ignores definition-like lines inside fenced code', () => {
    const content = base + '```\n[guide]: /manual\n```\n\nPlain tail';
    const { stable, tail } = splitMarkdownAtSafeBoundary(content);
    expect(stable).toBe(base + '```\n[guide]: /manual\n```\n\n');
    expect(tail).toBe('Plain tail');
  });
});
