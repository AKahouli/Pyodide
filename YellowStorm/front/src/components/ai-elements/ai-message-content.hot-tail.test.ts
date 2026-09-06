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
});
