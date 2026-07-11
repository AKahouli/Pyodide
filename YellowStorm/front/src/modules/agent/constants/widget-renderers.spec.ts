import { describe, expect, it } from 'vitest';
import {
  ensureCitationReferences,
  extractHighlightText,
  injectCitationMarkers,
  normalizeCitationReference,
  parseCitationPage,
  renderCitation,
  sortCitationsByReference,
} from './widget-renderers';

describe('widget citation helpers', () => {
  it('normalizes bracketed references', () => {
    expect(normalizeCitationReference('[1]')).toBe('1');
    expect(normalizeCitationReference('  2  ')).toBe('2');
    expect(normalizeCitationReference(undefined)).toBe('');
  });

  it('parses the last page number from citation page fields', () => {
    expect(parseCitationPage('5')).toBe('5');
    expect(parseCitationPage('report.pdf - page 12')).toBe('12');
    expect(parseCitationPage('')).toBe('');
    expect(parseCitationPage(undefined)).toBe('');
  });

  it('extracts highlight text from optional page wrappers', () => {
    expect(extractHighlightText('<page number=7>  hello   world  </page>')).toBe('hello world');
    expect(extractHighlightText('plain quote')).toBe('plain quote');
    expect(extractHighlightText('')).toBe('');
  });

  it('auto-assigns sequential references when missing', () => {
    const ensured = ensureCitationReferences([
      { fileName: 'a.pdf', url: 'a.pdf', reference: '2' },
      { fileName: 'b.pdf', url: 'b.pdf' },
      { fileName: 'c.pdf', url: 'c.pdf' },
    ]);

    expect(ensured.map((c) => c.reference)).toEqual(['2', '1', '3']);
  });

  it('sorts citations by numeric reference', () => {
    const sorted = sortCitationsByReference([
      { reference: '3', url: 'c.pdf', fileName: 'c.pdf' },
      { reference: '1', url: 'a.pdf', fileName: 'a.pdf' },
      { reference: '2', url: 'b.pdf', fileName: 'b.pdf' },
    ]);

    expect(sorted.map((c) => c.reference)).toEqual(['1', '2', '3']);
  });

  it('renders every citation as a clickable numbered badge', () => {
    const html = renderCitation({
      files: [
        {
          fileName: 'report.pdf',
          url: 'workspaces/ws1/report.pdf',
          workspaceId: 'ws1',
          reference: '1',
          page: 'report.pdf - page 5',
          pageNum: '5',
          highlightText: '<page number=5>Inflation remains elevated</page>',
        },
        {
          fileName: 'annex.pdf',
          url: 'workspaces/ws1/annex.pdf',
          reference: '[2]',
          page: '3',
        },
      ],
    });

    expect(html).toContain('ys-comp-citation-badge');
    expect(html).toContain('>1</a>');
    expect(html).toContain('>2</a>');
    expect(html).toContain('data-ys-source="workspaces/ws1/report.pdf"');
    expect(html).toContain('data-ys-source="workspaces/ws1/annex.pdf"');
    expect(html).toContain('data-ys-page="5"');
    expect(html).toContain('data-ys-page="3"');
    expect(html).toContain('data-ys-highlight="Inflation remains elevated"');
  });

  it('auto-numbers citations without reference so badges stay clickable', () => {
    const html = renderCitation({
      files: [
        { fileName: 'one.pdf', url: 'one.pdf' },
        { fileName: 'two.pdf', url: 'two.pdf' },
      ],
    });

    expect(html).toContain('>1</a>');
    expect(html).toContain('>2</a>');
    expect(html).toContain('data-ys-source="one.pdf"');
    expect(html).toContain('data-ys-source="two.pdf"');
  });

  it('injects clickable badges for every matching [n] marker in text', () => {
    const html = injectCitationMarkers('See claim [1] and detail [2].', [
      { reference: '1', fileName: 'a.pdf', url: 'a.pdf', pageNum: '4' },
      { reference: '2', fileName: 'b.pdf', url: 'b.pdf', pageNum: '9' },
    ]);

    expect(html).toContain('ys-comp-citation-badge');
    expect(html).toContain('data-ys-source="a.pdf"');
    expect(html).toContain('data-ys-source="b.pdf"');
    expect(html).toContain('data-ys-page="4"');
    expect(html).toContain('data-ys-page="9"');
    expect(html).not.toContain('[1]');
    expect(html).not.toContain('[2]');
  });

  it('keeps unmatched markers as plain text', () => {
    expect(injectCitationMarkers('Missing [9] only.', [{ reference: '1', url: 'a.pdf', fileName: 'a.pdf' }])).toContain(
      '[9]',
    );
  });
});
