import { describe, expect, it, vi } from 'vitest';
import { createScopedImageCache } from './document-images';

vi.mock('../../api', () => ({}));
vi.mock('./ConversationImageActions', () => ({ ConversationImageActions: () => null }));
vi.mock('@/components/ai-elements/ai-message-content', () => ({ SingleInlineCitation: () => null }));
vi.mock('./citations', () => ({ OpenUiCitationContext: {} }));

const image = { blob: new Blob(['image'], { type: 'image/png' }), generated: false };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('answer-owned image cache', () => {
  it('deduplicates in-flight and settled loads without sharing with another answer cache', async () => {
    const cache = createScopedImageCache();
    const loader = vi.fn().mockResolvedValue(image);
    const first = cache.resolve('conversation/message/source/page', loader);
    expect(cache.resolve('conversation/message/source/page', loader)).toBe(first);
    await first;
    expect(await cache.resolve('conversation/message/source/page', loader)).toBe(image);
    expect(loader).toHaveBeenCalledTimes(1);
    await createScopedImageCache().resolve('conversation/message/source/page', loader);
    await cache.resolve('conversation/message/source/other-page', loader);
    expect(loader).toHaveBeenCalledTimes(3);
    cache.dispose();
  });

  it('limits parallel image loads to four and starts queued work as slots free', async () => {
    const cache = createScopedImageCache();
    const finish: (() => void)[] = [];
    const loader = vi.fn(() => new Promise<typeof image>((resolve) => finish.push(() => resolve(image))));
    const tasks = Array.from({ length: 7 }, (_, index) => cache.resolve(String(index), loader));
    await settle(); expect(loader).toHaveBeenCalledTimes(4);
    finish.splice(0).forEach((resolve) => resolve());
    await settle(); expect(loader).toHaveBeenCalledTimes(7);
    finish.splice(0).forEach((resolve) => resolve());
    await Promise.all(tasks); cache.dispose();
  });

  it('evicts failed loads for retry while preserving successful entries', async () => {
    const cache = createScopedImageCache();
    const success = vi.fn().mockResolvedValue(image);
    const failure = vi.fn().mockRejectedValueOnce(new Error('Denied')).mockResolvedValue(image);
    await cache.resolve('good', success);
    await expect(cache.resolve('failed', failure)).rejects.toThrow('Denied');
    await cache.resolve('failed', failure);
    await cache.resolve('good', success);
    expect(success).toHaveBeenCalledTimes(1); expect(failure).toHaveBeenCalledTimes(2);
    cache.dispose();
  });

  it('retains at most 32 settled blobs and clears cached bytes when disposed', async () => {
    const cache = createScopedImageCache(); const loader = vi.fn().mockResolvedValue(image);
    for (let index = 0; index < 33; index++) await cache.resolve(String(index), loader);
    await cache.resolve('32', loader); expect(loader).toHaveBeenCalledTimes(33);
    await cache.resolve('0', loader); expect(loader).toHaveBeenCalledTimes(34);
    cache.dispose(); await cache.resolve('32', loader); expect(loader).toHaveBeenCalledTimes(35);
    cache.dispose();
  });

  it('aborts active requests and rejects queued requests without starting them on teardown', async () => {
    const cache = createScopedImageCache(); const signals: AbortSignal[] = [];
    const loader = vi.fn((signal: AbortSignal) => new Promise<typeof image>((_resolve, reject) => {
      signals.push(signal); signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const tasks = Array.from({ length: 7 }, (_, index) => cache.resolve(String(index), loader));
    const outcomes = Promise.allSettled(tasks);
    await settle(); cache.dispose();
    expect((await outcomes).every((result) => result.status === 'rejected')).toBe(true);
    expect(loader).toHaveBeenCalledTimes(4); expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
