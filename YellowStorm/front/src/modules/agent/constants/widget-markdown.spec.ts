import { describe, expect, it } from 'vitest';
import { widgetMarkdown } from './widget-markdown';

describe('widgetMarkdown', () => {
  it('renders markdown links without autolinking bare URLs', () => {
    const html = widgetMarkdown('[Reuters](https://www.reuters.com) and https://example.com');
    expect(html).toContain('href="https://www.reuters.com"');
    expect(html).toContain('https://example.com');
    expect(html).not.toContain('href="https://example.com"');
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

  it('escapes raw HTML before rendering markdown', () => {
    expect(widgetMarkdown('<script>alert(1)</script>')).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('rejects unsafe markdown link schemes', () => {
    expect(widgetMarkdown('[Open](javascript:alert(1))')).toContain('href="#"');
  });
});
