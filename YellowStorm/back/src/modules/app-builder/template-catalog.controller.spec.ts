import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { AppBuilderTemplateCategoryService } from './services/app-builder-template-category.service';
import { AppBuilderTemplateService } from './services/app-builder-template.service';
import { TemplateCatalogController } from './template-catalog.controller';
import { TEMPLATE_CATALOG_PREVIEW_WORKSPACE_ID } from './constants/template-catalog.constants';

const TEMPLATE_ID = '65f0000000000000000000a1';
const REVISION_ID = `template_${TEMPLATE_ID}`;

describe('TemplateCatalogController', () => {
  let controller: TemplateCatalogController;

  const categories = { findAll: jest.fn() };
  const templates = { listPublished: jest.fn(), requirePublished: jest.fn(), findById: jest.fn() };
  const runtimeRevisions = {
    listFiles: jest.fn(),
    getAuthorizedRevision: jest.fn(),
    resolveObjectKeys: jest.fn(),
  };
  const workspaceDocuments = { generateReadUrl: jest.fn() };

  const publishedRow = { id: TEMPLATE_ID, revisionId: REVISION_ID };

  beforeEach(async () => {
    jest.clearAllMocks();

    categories.findAll.mockResolvedValue([{ id: 'c1', name: 'Guides' }]);
    templates.listPublished.mockResolvedValue([]);
    templates.requirePublished.mockResolvedValue(publishedRow);
    templates.findById.mockResolvedValue({ id: TEMPLATE_ID, title: 'Landing' });
    runtimeRevisions.listFiles.mockResolvedValue({
      revisionId: REVISION_ID,
      files: [
        { path: 'package.json', sha256: 'a'.repeat(64), objectKey: 'blobs/a', size: 5 },
        { path: 'src/App.jsx', sha256: 'b'.repeat(64), objectKey: 'blobs/b', size: 10 },
      ],
    });
    runtimeRevisions.getAuthorizedRevision.mockResolvedValue({
      revisionId: REVISION_ID,
      files: [
        { path: 'package.json', sha256: 'a'.repeat(64), objectKey: 'blobs/a', size: 5 },
        { path: 'src/App.jsx', sha256: 'b'.repeat(64), objectKey: 'blobs/b', size: 10 },
      ],
    });
    runtimeRevisions.resolveObjectKeys.mockReturnValue([
      { path: 'package.json', objectKey: 'blobs/a', sha256: 'a'.repeat(64), size: 5 },
    ]);
    workspaceDocuments.generateReadUrl.mockResolvedValue('https://ceph/signed');

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TemplateCatalogController],
      providers: [
        { provide: AppBuilderTemplateCategoryService, useValue: categories },
        { provide: AppBuilderTemplateService, useValue: templates },
        { provide: RuntimeRevisionService, useValue: runtimeRevisions },
        { provide: WorkspaceDocumentService, useValue: workspaceDocuments },
      ],
    }).compile();

    controller = module.get(TemplateCatalogController);
  });

  it('lists categories and published templates', async () => {
    await expect(controller.listCategories()).resolves.toEqual([{ id: 'c1', name: 'Guides' }]);
    await controller.listTemplates('c1');
    expect(templates.listPublished).toHaveBeenCalledWith('c1');
  });

  it('requires a published template before returning its details', async () => {
    await expect(controller.getTemplate(TEMPLATE_ID)).resolves.toEqual({
      id: TEMPLATE_ID,
      title: 'Landing',
    });
    expect(templates.requirePublished).toHaveBeenCalledWith(TEMPLATE_ID);
  });

  it('lists preview files under the synthetic catalog workspace id', async () => {
    const result = await controller.listTemplatePreviewFiles(TEMPLATE_ID);

    expect(runtimeRevisions.listFiles).toHaveBeenCalledWith(
      TEMPLATE_CATALOG_PREVIEW_WORKSPACE_ID,
      REVISION_ID,
    );
    expect(result).toEqual({
      revisionId: REVISION_ID,
      files: [
        { path: 'package.json', sha256: 'a'.repeat(64), size: 5 },
        { path: 'src/App.jsx', sha256: 'b'.repeat(64), size: 10 },
      ],
    });
  });

  it('presigns preview files under the synthetic catalog workspace id', async () => {
    const result = await controller.presignTemplatePreviewFiles(TEMPLATE_ID, { paths: ['package.json'] });

    expect(runtimeRevisions.getAuthorizedRevision).toHaveBeenCalledWith(
      TEMPLATE_CATALOG_PREVIEW_WORKSPACE_ID,
      REVISION_ID,
    );
    expect(runtimeRevisions.resolveObjectKeys).toHaveBeenCalledWith(
      expect.objectContaining({ revisionId: REVISION_ID }),
      ['package.json'],
    );
    expect(workspaceDocuments.generateReadUrl).toHaveBeenCalledWith('blobs/a', {
      allowExtensionless: true,
    });
    expect(result).toEqual({ items: [{ path: 'package.json', url: 'https://ceph/signed' }] });
  });

  it.each([
    ['files', (): Promise<unknown> => controller.listTemplatePreviewFiles(TEMPLATE_ID)],
    [
      'presign',
      (): Promise<unknown> =>
        controller.presignTemplatePreviewFiles(TEMPLATE_ID, { paths: ['package.json'] }),
    ],
  ])('answers ERR_3805 on %s when the template has no bound revision', async (_label, call) => {
    templates.requirePublished.mockResolvedValue({ id: TEMPLATE_ID, revisionId: '' });

    await expect(call()).rejects.toMatchObject({
      code: ErrorCode.APP_BUILDER_TEMPLATE_NOT_PUBLISHED,
    });
    await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    expect(runtimeRevisions.listFiles).not.toHaveBeenCalled();
    expect(runtimeRevisions.getAuthorizedRevision).not.toHaveBeenCalled();
  });
});