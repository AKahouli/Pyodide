import { describe, expect, it } from 'vitest';
import { generateExpectedOutputFormat } from './replay-reference-defaults';

const translate = (key: string, values?: Record<string, string | number>) => `${key}:${Object.values(values ?? {}).join('|')}`;

describe('generateExpectedOutputFormat', () => {
  it('returns no guide for an empty trusted answer', () => {
    expect(generateExpectedOutputFormat('   ', translate)).toBeNull();
  });

  it('describes JSON keys and value types without retaining scalar values', () => {
    const guide = generateExpectedOutputFormat('{"name":"Acme","count":3,"items":[{"approved":true}]}', translate);

    expect(guide).toContain('nodeEditor.referenceFormatGeneratedJson');
    expect(guide).toContain('"name": "<string>"');
    expect(guide).toContain('"count": "<number>"');
    expect(guide).toContain('"approved": "<boolean>"');
    expect(guide).not.toContain('Acme');
  });

  it('summarizes visible Markdown structure deterministically', () => {
    const answer = '## Result\n\nSummary text.\n\n| Name | Value |\n| --- | --- |\n| File | report.pdf |\n\n- Verified';
    const first = generateExpectedOutputFormat(answer, translate);
    const second = generateExpectedOutputFormat(answer, translate);

    expect(first).toBe(second);
    expect(first).toContain('nodeEditor.referenceFormatGeneratedMarkdown');
    expect(first).toContain('nodeEditor.referenceFormatHeading');
    expect(first).toContain('nodeEditor.referenceFormatTables');
    expect(first).toContain('nodeEditor.referenceFormatBullets');
  });

  it('falls back to paragraph and line counts for plain text', () => {
    const guide = generateExpectedOutputFormat('First paragraph.\n\nSecond paragraph.', translate);

    expect(guide).toContain('nodeEditor.referenceFormatGeneratedPlain');
    expect(guide).toContain(':2|2');
  });

  it('bounds generated guides for oversized structured answers', () => {
    const largeJson = JSON.stringify(Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`${'very-long-key-'.repeat(20)}${index}`, { value: index }]),
    ));
    const largeMarkdown = Array.from(
      { length: 200 },
      (_, index) => `## ${`Detailed heading ${index} `.repeat(20)}`,
    ).join('\n\nContent.\n\n');

    expect(generateExpectedOutputFormat(largeJson, translate)?.length).toBeLessThanOrEqual(8000);
    expect(generateExpectedOutputFormat(largeMarkdown, translate)?.length).toBeLessThanOrEqual(8000);
  });
});
