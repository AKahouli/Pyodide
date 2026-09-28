import { describe, it, expect, vi, beforeEach } from 'vitest';

const postMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    post: postMock,
    put: putMock,
  },
}));

import { adminTemplateApi } from './api';

const template = { id: 'tpl_1' };
const zip = new File(['zip'], 'template.zip', { type: 'application/zip' });
const cover = new File(['svg'], 'cover.svg', { type: 'image/svg+xml' });

describe('adminTemplateApi source uploads', () => {
  beforeEach(() => {
    postMock.mockReset().mockResolvedValue({ data: { data: template } });
    putMock.mockReset().mockResolvedValue({ data: { data: template } });
  });

  it('gives template ZIP publishing more than the default HTTP budget', async () => {
    await adminTemplateApi.createTemplate({
      categoryId: 'cat_1',
      title: 'Chat starter',
      zip,
      cover,
    });

    expect(postMock).toHaveBeenCalledWith(
      '/admin/conversation-v2/templates',
      expect.any(FormData),
      { timeout: 300_000 },
    );
  });

  it('applies the same budget when replacing an existing template source', async () => {
    await adminTemplateApi.replaceSource('tpl_1', zip);

    expect(putMock).toHaveBeenCalledWith(
      '/admin/conversation-v2/templates/tpl_1/source',
      expect.any(FormData),
      { timeout: 300_000 },
    );
  });
});
