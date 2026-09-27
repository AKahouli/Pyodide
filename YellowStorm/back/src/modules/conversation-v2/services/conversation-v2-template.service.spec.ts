import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { DocumentService } from '@modules/document/document.service';
import { ConversationV2TemplateService, type MulterFile } from './conversation-v2-template.service';

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
  id: 'tpl_1',
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
    setPublished: jest.fn(),
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
    templates.update.mockImplementation(async (_id, patch) => ({ ...draftRow, ...patch }));
    publish.publish.mockResolvedValue({
      revisionId: 'template_tpl_1',
      manifestObjectKey: 'appbuilder/manifests/_system/template_tpl_1.json',
      fileCount: 2,
    });
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

  it('creates, uploads the cover and publishes the ZIP to Ceph', async () => {
    templates.setPublished.mockResolvedValueOnce({
      ...draftRow,
      coverImage: 'appbuilder/templates/tpl_1/cover.png',
      revisionId: 'template_tpl_1',
      manifestObjectKey: 'appbuilder/manifests/_system/template_tpl_1.json',
      status: 'published',
    });

    const result = await svc.create({ categoryId: 'c1', title: 'Landing' }, ZIP, COVER);

    expect(documents.upload).toHaveBeenCalledWith(
      COVER.buffer,
      'cover.png',
      'image/png',
      {
        generateUniqueName: false,
        customFileName: 'appbuilder/templates/tpl_1/cover.png',
      },
    );
    expect(publish.publish).toHaveBeenCalledWith('tpl_1', ZIP.buffer);
    expect(templates.setPublished).toHaveBeenCalledWith('tpl_1', {
      revisionId: 'template_tpl_1',
      manifestObjectKey: 'appbuilder/manifests/_system/template_tpl_1.json',
    });
    expect(result).toMatchObject({
      id: 'tpl_1',
      status: 'published',
      revisionId: 'template_tpl_1',
      coverImage: 'https://ceph/signed',
      categoryName: 'Guides',
    });
  });

  it('rejects a duplicate title within the category', async () => {
    templates.findByCategoryAndTitle.mockResolvedValueOnce(draftRow);
    await expect(
      svc.create({ categoryId: 'c1', title: 'Landing' }, ZIP, COVER),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a missing or oversized source ZIP/cover', async () => {
    await expect(svc.create({ categoryId: 'c1', title: 'X' }, undefined, COVER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      svc.create({ categoryId: 'c1', title: 'X' }, ZIP, { ...COVER, mimetype: 'text/plain' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requirePublished rejects a draft template', async () => {
    templates.findById.mockResolvedValueOnce(draftRow);
    await expect(svc.requirePublished('tpl_1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes the row and cleans its Ceph artifacts', async () => {
    const row = { ...draftRow, coverImage: 'cover' };
    templates.delete.mockResolvedValueOnce(row);

    await svc.delete('tpl_1');

    expect(publish.removeTemplateArtifacts).toHaveBeenCalledWith([row]);
  });
});
