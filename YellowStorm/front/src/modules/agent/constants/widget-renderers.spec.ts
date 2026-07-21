import { describe, expect, it } from 'vitest';
import {
  ensureCitationReferences,
  extractHighlightText,
  injectCitationMarkers,
  normalizeCitationReference,
  parseCitationPage,
  renderCitation,
  renderChoice,
  renderSources,
  RENDERER_MAP,
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

describe('widget choice renderer', () => {
  it('exposes and safely renders quick replies', () => {
    const html = renderChoice({
      schemaVersion: 1,
      prompt: '<Pick>',
      options: [{ id: 'one', label: '<One>' }, { id: 'two', label: 'Two' }],
    }, 'choice-1');
    expect(RENDERER_MAP.choice).toBe(renderChoice);
    expect(html).toContain('ys-choice-quick');
    expect(html).toContain('&lt;Pick&gt;');
    expect(html).toContain('&lt;One&gt;');
  });

  it('uses the matching web-source title as the citation anchor label', () => {
    const sources = [{ title: 'Aide de la Ville de Nanterre', url: ' https://www.nanterre.fr/aides ' }];
    const citation = { reference: '1', url: 'https://www.nanterre.fr/aides', fileName: 'nante...fr' };

    expect(injectCitationMarkers('See [1].', [citation], sources)).toContain('>Aide de la Ville de Nanterre</a>');
    expect(renderCitation({ files: [citation], sources })).toContain('>Aide de la Ville de Nanterre</a>');
  });

  it('keeps the existing citation label when no titled web source matches', () => {
    const html = renderCitation({
      files: [{ reference: '1', url: 'workspaces/ws1/report.pdf', fileName: 'report.pdf' }],
      sources: [{ title: 'Unrelated source', url: 'https://example.com/other' }],
    });

    expect(html).toContain('>1</a>');
    expect(html).not.toContain('>Unrelated source</a>');
  });
});

describe('widget source rendering', () => {
  it('renders the full escaped source title as a clickable link', () => {
    const title = 'A detailed source title that should remain readable in the widget without truncation';
    const html = renderSources({ sources: [{ title, url: 'https://example.com/resource' }] });

    expect(html).toContain(`>${title}</span>`);
    expect(html).toContain('href="https://example.com/resource"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it('trims safe source URLs before rendering them', () => {
    const html = renderSources({ sources: [{ title: 'Example', url: ' https://example.com/resource ' }] });

    expect(html).toContain('href="https://example.com/resource"');
    expect(html).toContain('title="https://example.com/resource"');
  });

  it('does not expose unsafe source URL schemes', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', '//untrusted.example']) {
      const html = renderSources({ sources: [{ title: 'Unsafe', url }] });
      expect(html).toContain('href="#"');
      expect(html).not.toContain(`href="${url}`);
    }
  });
});
