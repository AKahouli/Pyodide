import { describe, expect, it } from 'vitest';
import { exportBlocksToHtml } from './html-export';

describe('exportBlocksToHtml', () => {
  it('creates a standalone rendered HTML document and escapes unsafe content', async () => {
    const blob = exportBlocksToHtml([
      { label: 'Assistant', timestamp: 'Today', markdown: '**Answer** <script>alert(1)</script>' },
    ], 'Report </title><script>alert(2)</script>');
    const html = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<strong>Answer</strong>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });
});
