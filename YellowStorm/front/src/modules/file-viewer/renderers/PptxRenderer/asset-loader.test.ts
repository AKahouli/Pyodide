import { describe, expect, it, vi } from 'vitest';
import { ensurePptxAssets } from './asset-loader';

describe('ensurePptxAssets', () => {
  it('injects style/script tags and reuses same promise', async () => {
    const headAppend = document.head.appendChild.bind(document.head);
    const bodyAppend = document.body.appendChild.bind(document.body);

    const headAppendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      headAppend(node);
      const element = node as HTMLLinkElement;
      queueMicrotask(() => element.onload?.(new Event('load')));
      return node;
    });
    const bodyAppendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      bodyAppend(node);
      const element = node as HTMLScriptElement;
      queueMicrotask(() => element.onload?.(new Event('load')));
      return node;
    });

    const first = ensurePptxAssets();
    await first;

    expect(document.querySelectorAll('link[data-pptx-style]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('script[data-pptx-script]').length).toBeGreaterThan(0);

    const second = ensurePptxAssets();
    expect(second).toBe(first);

    headAppendSpy.mockRestore();
    bodyAppendSpy.mockRestore();
  });
});
