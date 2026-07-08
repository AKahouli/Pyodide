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
});
