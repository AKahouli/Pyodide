import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { resolveOpenUiExportImage } from './openui-export-assets';
import { fetchSlideExportImage } from '../api';
import { loadGeneratedImage, loadDocumentImage } from '../components/openui/document-images';

vi.mock('../api', () => ({ fetchSlideExportImage: vi.fn() }));
vi.mock('../components/openui/document-images', () => ({
  GENERATED_IMAGE_REFERENCE: /^generated-image:([a-f\d]{24})$/,
  loadGeneratedImage: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  loadDocumentImage: vi.fn(),
}));
const component = { id: 'part', type: 'text' as const, data: { content: '' } };
const message: Message = { id: 'answer', conversationId: 'conversation', conversationType: 'ai', createdAt: '2026-10-15T18:00:00Z', components: [component] };

describe('scoped OpenUI export assets', () => {
  it('keeps repeated citation markers scoped to their original text component', async () => {
    const first = { ...component, id: 'first', data: { content: 'Image [1]' } };
    const second = { ...component, id: 'second', data: { content: 'Image [1]' } };
    const citations = [first, second].map((part, index) => ({ id: `cite-${index}`, type: 'citation' as const,
      data: { parentId: part.id, reference: '1', source: `file-${index}.pdf`, fileName: `file-${index}.pdf`, page: String(index + 1) } }));
    vi.mocked(loadDocumentImage).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    await resolveOpenUiExportImage('[1]', second, { ...message, components: [first, second, ...citations] });
    expect(loadDocumentImage).toHaveBeenLastCalledWith(expect.objectContaining({ parentId: 'second', fileName: 'file-1.pdf', page: '2' }), { conversationId: 'conversation', messageId: 'answer' });
  });
  it('resolves a saved image using the answer scope and embeds bytes', async () => {
    const source = 'generated-image:123456789012345678901234';
    await expect(resolveOpenUiExportImage(source, component, message)).resolves.toBe('data:image/png;base64,cG5n');
    expect(loadGeneratedImage).toHaveBeenCalledWith(source, { conversationId: 'conversation', messageId: 'answer' });
  });
  it('uses the authorized proxy for public image sources', async () => {
    vi.mocked(fetchSlideExportImage).mockResolvedValueOnce('data:image/jpeg;base64,aW1hZ2U=');
    await expect(resolveOpenUiExportImage('https://images.example/photo.jpg', component, message)).resolves.toBe('data:image/jpeg;base64,aW1hZ2U=');
    expect(fetchSlideExportImage).toHaveBeenCalledWith('conversation', 'answer', 'https://images.example/photo.jpg', expect.any(AbortSignal));
  });
  it.each(['http://example.com/a.png', 'javascript:alert(1)', 'https://user:password@example.com/a.png', '[99]'])('rejects untrusted or missing sources: %s', async (source) => {
    await expect(resolveOpenUiExportImage(source, component, message)).rejects.toThrow();
  });
});
