import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: getMock,
    patch: vi.fn(),
    delete: vi.fn(),
    post: postMock,
    put: putMock,
  },
}));

import { adminTemplateApi, appBuilderApi, templateCatalogApi } from './api';

const template = { id: 'tpl_1' };
const zip = new File(['zip'], 'template.zip', { type: 'application/zip' });
const cover = new File(['svg'], 'cover.svg', { type: 'image/svg+xml' });

describe('appBuilderApi.listApps', () => {
  beforeEach(() => getMock.mockReset());

  it('falls back to empty catalog sections when the payload omits them', async () => {
    getMock.mockResolvedValue({ data: { data: { deployed: [{ sessionId: 's1' }] } } });

    await expect(appBuilderApi.listApps()).resolves.toEqual({
      deployed: [{ sessionId: 's1' }],
      shared: [],
      drafts: [],
    });
  });

  it('survives an empty response envelope', async () => {
    getMock.mockResolvedValue({ data: { data: null } });

    await expect(appBuilderApi.listApps()).resolves.toEqual({
      deployed: [],
      shared: [],
      drafts: [],
    });
  });
});

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

describe('adminTemplateApi.listAllTemplates', () => {
  beforeEach(() => getMock.mockReset());

  it('loads the unfiltered admin template catalog', async () => {
    getMock.mockResolvedValue({ data: { data: [template] } });

    await expect(adminTemplateApi.listAllTemplates()).resolves.toEqual([template]);
    expect(getMock).toHaveBeenCalledWith('/admin/conversation-v2/templates');
  });
});

describe('templateCatalogApi preview DTOs', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('returns typed preview file listings', async () => {
    const payload = {
      revisionId: 'template_tpl_1',
      files: [{ path: 'src/App.jsx', sha256: 'abc', size: 12 }],
    };
    getMock.mockResolvedValue({ data: { data: payload } });

    await expect(templateCatalogApi.listTemplatePreviewFiles('tpl_1')).resolves.toEqual(
      payload,
    );
    expect(getMock).toHaveBeenCalledWith(
      '/conversation-v2/template-catalog/templates/tpl_1/preview/files',
    );
  });

  it('returns typed preview presign items', async () => {
    const payload = { items: [{ path: 'src/App.jsx', url: 'https://cdn/x' }] };
    postMock.mockResolvedValue({ data: { data: payload } });

    await expect(
      templateCatalogApi.presignTemplatePreviewFiles('tpl_1', ['src/App.jsx']),
    ).resolves.toEqual(payload);
    expect(postMock).toHaveBeenCalledWith(
      '/conversation-v2/template-catalog/templates/tpl_1/preview/presign',
      { paths: ['src/App.jsx'] },
    );
  });
});
