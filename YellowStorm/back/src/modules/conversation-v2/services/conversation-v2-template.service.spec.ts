import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { DocumentService } from '@modules/document/document.service';
import { ConversationV2TemplateService } from './conversation-v2-template.service';
import type { MulterFile } from '../interfaces/multer-file.interface';

const TPL_ID = 'a'.repeat(24);
const ZIP: MulterFile = {
  originalname: 'template.zip',
  mimetype: 'application/zip',
  size: 10,
  buffer: Buffer.from('zip'),
};
const COVER: MulterFile = {
  originalname: 'cover.png',
  mimetype: 'image/png',
  size: 10,
  buffer: Buffer.from('png'),
};

const draftRow = {
  id: TPL_ID,
  categoryId: 'c1',
  title: 'Landing',
  description: '',
  coverImage: '',
  revisionId: null,
  manifestObjectKey: null,
  status: 'draft' as const,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe('ConversationV2TemplateService', () => {
  const templates = {
    findById: jest.fn(),
    findByCategoryId: jest.fn(),
    findByRevisionId: jest.fn(),
    findByCategoryAndTitle: jest.fn(),
    listPublished: jest.fn(),
    listAll: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    setRevision: jest.fn(),
    markPublished: jest.fn(),
    upsertRevision: jest.fn(),
    markRevisionsPublished: jest.fn(),
    listRevisionsByTemplate: jest.fn(),
    delete: jest.fn(),
  };
  const categories = { findById: jest.fn(), findAll: jest.fn() };
  const publish = { publish: jest.fn(), removeTemplateArtifacts: jest.fn() };
  const documents = { upload: jest.fn(), generateSasUrl: jest.fn() };

  let svc: ConversationV2TemplateService;

  beforeEach(() => {
    jest.clearAllMocks();
    categories.findById.mockResolvedValue({ id: 'c1', name: 'Guides' });
    categories.findAll.mockResolvedValue([{ id: 'c1', name: 'Guides' }]);
    templates.findByCategoryAndTitle.mockResolvedValue(null);
    templates.insert.mockResolvedValue(draftRow);
    templates.update.mockImplementation((_id: string, patch: Record<string, unknown>) =>
      Promise.resolve({ ...draftRow, ...patch }),
    );
    templates.setRevision.mockImplementation((_id: string, binding: Record<string, unknown>) =>
      Promise.resolve({ ...draftRow, ...binding }),
    );
    publish.publish.mockResolvedValue({
      revisionId: `template_${TPL_ID}`,
      manifestObjectKey: `appbuilder/manifests/_system/template_${TPL_ID}.json`,
      manifestHash: 'manifest-hash',
      fileCount: 2,
      files: [
        { path: 'package.json', sha256: 'a'.repeat(64), objectKey: 'blobs/a', size: 5 },
        { path: 'src/App.jsx', sha256: 'b'.repeat(64), objectKey: 'blobs/b', size: 10 },
      ],
    });
    templates.upsertRevision.mockResolvedValue({});
    templates.markRevisionsPublished.mockResolvedValue(undefined);
    publish.removeTemplateArtifacts.mockResolvedValue(undefined);
    documents.upload.mockResolvedValue({});
    documents.generateSasUrl.mockResolvedValue('https://ceph/signed');

    svc = new ConversationV2TemplateService(
      templates as never,
      categories as never,
      publish as never,
      documents as unknown as DocumentService,
    );
  });

  it('creates a published template, uploads the cover and publishes the ZIP to Ceph', async () => {
    const bound = {
      ...draftRow,
      coverImage: `appbuilder/templates/${TPL_ID}/cover.png`,
      revisionId: `template_${TPL_ID}`,
      manifestObjectKey: `appbuilder/manifests/_system/template_${TPL_ID}.json`,
    };
    templates.setRevision.mockResolvedValueOnce(bound);
    templates.markPublished.mockResolvedValueOnce({ ...bound, status: 'published' as const });

    const result = await svc.create({ categoryId: 'c1', title: 'Landing' }, ZIP, COVER);

    expect(documents.upload).toHaveBeenCalledWith(COVER.buffer, 'cover.png', 'image/png', {
      generateUniqueName: false,
      customFileName: `appbuilder/templates/${TPL_ID}/cover.png`,
    });
    expect(publish.publish).toHaveBeenCalledWith(TPL_ID, ZIP.buffer);
    expect(templates.setRevision).toHaveBeenCalledWith(TPL_ID, {
      revisionId: `template_${TPL_ID}`,
      manifestObjectKey: `appbuilder/manifests/_system/template_${TPL_ID}.json`,
      platformReport: undefined,
    });
    expect(templates.upsertRevision).toHaveBeenCalledWith({
      templateId: TPL_ID,
      revisionId: `template_${TPL_ID}`,
      manifestObjectKey: `appbuilder/manifests/_system/template_${TPL_ID}.json`,
      manifestHash: 'manifest-hash',
      files: expect.arrayContaining([expect.objectContaining({ path: 'package.json' })]) as unknown[],
    });
    expect(templates.markPublished).toHaveBeenCalledWith(TPL_ID);
    expect(templates.markRevisionsPublished).toHaveBeenCalledWith(TPL_ID);
    expect(result).toMatchObject({
      id: TPL_ID,
      status: 'published',
      revisionId: `template_${TPL_ID}`,
      coverImage: 'https://ceph/signed',
      categoryName: 'Guides',
    });
  });

  it('rolls back the draft row when the revision binding disappears', async () => {
    templates.setRevision.mockResolvedValueOnce(null);
    templates.delete.mockResolvedValueOnce(draftRow);

    await expect(
      svc.create({ categoryId: 'c1', title: 'Landing' }, ZIP, COVER),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(templates.upsertRevision).not.toHaveBeenCalled();
    expect(templates.markPublished).not.toHaveBeenCalled();
    expect(templates.delete).toHaveBeenCalledWith(TPL_ID);
  });

  it('rejects a duplicate title within the category', async () => {
    templates.findByCategoryAndTitle.mockResolvedValueOnce(draftRow);
    await expect(
      svc.create({ categoryId: 'c1', title: 'Landing' }, ZIP, COVER),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a missing or oversized source ZIP/cover', async () => {
    await expect(
      svc.create({ categoryId: 'c1', title: 'X' }, undefined, COVER),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.create({ categoryId: 'c1', title: 'X' }, ZIP, { ...COVER, mimetype: 'text/plain' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requirePublished rejects a draft template', async () => {
    templates.findById.mockResolvedValueOnce(draftRow);
    await expect(svc.requirePublished(TPL_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requireUsableForUser allows a super admin to use a draft', async () => {
    templates.findById.mockResolvedValueOnce({ ...draftRow, revisionId: `template_${TPL_ID}` });
    await expect(svc.requireUsableForUser(TPL_ID, true)).resolves.toMatchObject({
      revisionId: `template_${TPL_ID}`,
    });

    templates.findById.mockResolvedValueOnce(draftRow);
    await expect(svc.requireUsableForUser(TPL_ID, false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes the row and kicks off Ceph artifact cleanup in the background', async () => {
    const row = { ...draftRow, coverImage: 'cover' };
    templates.delete.mockResolvedValueOnce(row);

    await svc.delete(TPL_ID);

    expect(publish.removeTemplateArtifacts).toHaveBeenCalledWith([row]);
  });
});
