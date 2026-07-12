import { describe, expect, it } from 'vitest';
import { widgetMarkdown } from './widget-markdown';

describe('widgetMarkdown', () => {
  it('renders Markdown and bare HTTP(S) links as safe chips', () => {
    const html = widgetMarkdown('[Reuters](https://www.reuters.com) and https://example.com');
    expect(html).toContain('href="https://www.reuters.com"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('>example.com</a>');
  });

  it('renders agent citations as titled HTTP(S) links', () => {
    const html = widgetMarkdown('[Aide de la Ville de Nanterre, https://www.nanterre.fr/aides]');

    expect(html).toContain('href="https://www.nanterre.fr/aides"');
    expect(html).toContain('>Aide de la Ville de Nanterre</a>');
    expect(html).not.toContain('[Aide de la Ville');
  });

  it('does not turn agent citation syntax in inline code into a link', () => {
    const html = widgetMarkdown('`[Unsafe, https://example.com]`');

    expect(html).toContain('<code class="ys-md-inline-code">[Unsafe, https://example.com]</code>');
    expect(html).not.toContain('href="https://example.com"');
  });

  it('renders bare email addresses as mailto links without changing code', () => {
    const html = widgetMarkdown('Contact aide@example.com or use `aide@example.com`.');

    expect(html).toContain('href="mailto:aide@example.com"');
    expect(html).toContain('<code class="ys-md-inline-code">aide@example.com</code>');
    expect(html.match(/href="mailto:aide@example\.com"/g)).toHaveLength(1);
  });

  it('preserves inline code', () => {
    const html = widgetMarkdown('Use `https://example.com` as code.');
    expect(html).toContain('<code class="ys-md-inline-code">https://example.com</code>');
  });

  it('renders supported heading levels with widget-owned classes', () => {
    const html = widgetMarkdown('# Heading\n###### Detail');

    expect(html).toContain('<h1 class="ys-md-h1">Heading</h1>');
    expect(html).toContain('<h6 class="ys-md-h6">Detail</h6>');
  });

  it('renders GFM pipe tables with inline markdown in cells', () => {
    const html = widgetMarkdown('| Device | Amount |\n| :--- | ---: |\n| **Grant** | [10 000 EUR](https://example.com) |');

    expect(html).toContain('<div class="ys-md-table-wrap"><table class="ys-md-table">');
    expect(html).toContain('<th class="ys-md-table-left">Device</th>');
    expect(html).toContain('class="ys-md-table-left"');
    expect(html).toContain('class="ys-md-table-right"');
    expect(html).toContain('<td class="ys-md-table-left"><strong>Grant</strong></td>');
    expect(html).toContain('href="https://example.com"');
  });

  it('keeps malformed tables and inline-code pipes as ordinary paragraphs', () => {
    const html = widgetMarkdown('Device | Amount\n| --- | -- |\nUse `left | right` as code.');

    expect(html).not.toContain('ys-md-table');
    expect(html).toContain('<p class="ys-md-p">Device | Amount</p>');
    expect(html).toContain('<code class="ys-md-inline-code">left | right</code>');
  });

  it('escapes raw HTML before rendering markdown', () => {
    expect(widgetMarkdown('<script>alert(1)</script>')).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('rejects unsafe markdown link schemes', () => {
    expect(widgetMarkdown('[Open](javascript:alert(1))')).toContain('href="#"');
  });
});
