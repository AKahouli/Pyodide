import { ConversationArtifactService } from './conversation-artifact.service';
import { Readable } from 'node:stream';

describe('ConversationArtifactService', () => {
  const messageService = { getMessageDocument: jest.fn(), listRecentArtifactMessages: jest.fn() };
  const documentService = { isAvailable: jest.fn(() => true), generateSasUrl: jest.fn(), openReadStream: jest.fn(), copy: jest.fn() };
  const conversationService = {
    getConversationDocument: jest.fn(),
    filterAccessibleWorkspaceIds: jest.fn(async (_userId: string | undefined, ids: string[]) => ids),
  };
  const workspaceDocumentService = { findByMultipleWorkspaces: jest.fn() };
  const service = new ConversationArtifactService(
    messageService as never,
    documentService as never,
    conversationService as never,
    workspaceDocumentService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  describe('generated images', () => {
    const id = '1234567890abcdef12345678';
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const post = jest.fn();
    const agents = { findByIds: jest.fn() };
    const tools = { findAllActive: jest.fn() };
    const models = { findById: jest.fn() };
    const workspaces = { uploadSmallFile: jest.fn(), findById: jest.fn(), findByMultipleWorkspaces: jest.fn() };
    const conversations = { getConversationDocument: jest.fn(), ensureSystemWorkspace: jest.fn(),
      filterAccessibleWorkspaceIds: jest.fn() };
    const downloader = { assertUrlIsSafe: jest.fn(), download: jest.fn() };
    const generator = new ConversationArtifactService(messageService as never, documentService as never,
      conversations as never, workspaces as never, undefined, undefined, downloader as never,
      models as never, { getHttpClient: () => ({ post }) } as never, agents as never, tools as never);
    const request = { conversationId: 'c', userId: 'u', agentId: 'a', model: 'gpt-image-2.5-flare',
      prompt: 'A mountain', aspectRatio: 'landscape' as const };
    beforeEach(() => {
      conversations.getConversationDocument.mockResolvedValue({ createdBy: 'u', systemWorkspaceId: 'w' });
      conversations.ensureSystemWorkspace.mockResolvedValue('w');
      conversations.filterAccessibleWorkspaceIds.mockResolvedValue(['allowed']);
      workspaces.findByMultipleWorkspaces.mockResolvedValue({ documents: [{ id: 'upload', filename: 'photo.png',
        originalName: 'photo.png', path: 'allowed/photo.png', mimeType: 'image/png', size: png.length, status: 'completed' }],
        pagination: { total: 1 } });
      downloader.download.mockResolvedValue({ data: png, headers: { 'content-type': 'image/png' } });
      agents.findByIds.mockResolvedValue([{ isActive: true, tools: ['t'], agentType: { slug: 'mono' } }]);
      tools.findAllActive.mockResolvedValue([{ id: 't', name: 'generate_image', attributes: [], defaultAgentTypes: [] }]);
      models.findById.mockResolvedValue({ isActive: true, type: 'image_generation', types: [] });
      post.mockResolvedValue({ data: { data: [{ b64_json: png.toString('base64') }] } });
      workspaces.uploadSmallFile.mockResolvedValue({ id, path: 'stored/new-image.png' });
      workspaces.findById.mockResolvedValue({ id, originalName: 'generated-test.png', path: 'stored/image.png', mimeType: 'image/png' });
      documentService.openReadStream.mockImplementation(async () => ({ body: Readable.from([png]) }));
      messageService.getMessageDocument.mockResolvedValue({ conversationId: 'c', conversationType: 'ai',
        content: `Image("AI generated", "generated-image:${id}")` });
    });
    it('generates one catalog-backed image and stores it without indexing or leaking bytes', async () => {
      expect(await generator.generateImage(request)).toMatchObject({ imageSource: `generated-image:${id}`, generated: true });
      expect(post).toHaveBeenCalledWith('/v1/images/generations', expect.objectContaining({ model: request.model,
        n: 1, size: '1536x1024' }), expect.objectContaining({ timeout: 180000 }));
      expect(workspaces.uploadSmallFile).toHaveBeenCalledWith('w', 'u', png, expect.any(String), 'image/png', undefined, undefined, false);
      expect(documentService.copy).toHaveBeenCalledWith('stored/new-image.png', `u/system_c/generated-images/${id}.png`);
    });
    it('reuses an authorized previous image without model calls and stages the same path after reload', async () => {
      const reuse = { ...request, prompt: '', reuseImage: `generated-image:${id}` };
      const receipt = await generator.generateImage(reuse);
      expect(receipt).toEqual({ imageSource: `generated-image:${id}`, fileName: 'generated-test.png',
        mimeType: 'image/png', generated: true, sandboxPath: `/mnt/workspace/generated-images/${id}.png` });
      expect(await generator.generateImage(reuse)).toEqual(receipt);
      expect(documentService.copy).toHaveBeenLastCalledWith('stored/image.png', `u/system_c/generated-images/${id}.png`);
      expect(post).not.toHaveBeenCalled();
      expect(models.findById).not.toHaveBeenCalled();
      expect(workspaces.uploadSmallFile).not.toHaveBeenCalled();
    });
    it('rejects ambiguous, foreign and invalid reuse references before copying', async () => {
      await expect(generator.generateImage({ ...request, reuseImage: `generated-image:${id}`,
        sourceImage: `generated-image:${id}` })).rejects.toThrow('either');
      await expect(generator.generateImage({ ...request, reuseImage: 'stored/private.png' })).rejects.toThrow('not found');
      workspaces.findById.mockRejectedValueOnce(new Error('Image not found'));
      await expect(generator.generateImage({ ...request, reuseImage: `generated-image:${id}` })).rejects.toThrow('not found');
      expect(documentService.copy).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    });
    it('rejects inaccessible conversations, unassigned tools and inactive models before spending', async () => {
      conversations.getConversationDocument.mockResolvedValueOnce({ createdBy: 'other' });
      await expect(generator.generateImage(request)).rejects.toThrow('not found');
      tools.findAllActive.mockResolvedValueOnce([]);
      await expect(generator.generateImage(request)).rejects.toThrow('not enabled');
      models.findById.mockResolvedValueOnce({ isActive: false });
      await expect(generator.generateImage(request)).rejects.toThrow('active image');
      expect(post).not.toHaveBeenCalled();
    });
    it.each([
      {},
      { sourceImage: `generated-image:${id}` },
      { reuseImage: `generated-image:${id}` },
    ])('blocks another user before reading, editing or staging an image (%j)', async (mode) => {
      conversations.getConversationDocument.mockResolvedValueOnce({ createdBy: 'other-user', systemWorkspaceId: 'other-workspace' });
      await expect(generator.generateImage({ ...request, ...mode })).rejects.toThrow('not found');
      expect(workspaces.findById).not.toHaveBeenCalled();
      expect(workspaces.findByMultipleWorkspaces).not.toHaveBeenCalled();
      expect(documentService.openReadStream).not.toHaveBeenCalled();
      expect(documentService.copy).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    });
    it.each(['sourceImage', 'reuseImage'] as const)('rejects a foreign generated-image ID in an owned conversation (%s)', async (mode) => {
      // The owning conversation has workspace w; the foreign ID exists only in another workspace.
      workspaces.findById.mockImplementationOnce(async (workspaceId: string) => {
        if (workspaceId === 'other-workspace') return { id, path: 'other-user/private.png', mimeType: 'image/png' };
        throw new Error('Image not found');
      });
      await expect(generator.generateImage({ ...request, [mode]: `generated-image:${id}` })).rejects.toThrow('not found');
      expect(workspaces.findById).toHaveBeenCalledWith('w', id);
      expect(documentService.openReadStream).not.toHaveBeenCalled();
      expect(documentService.copy).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    });
    it('edits only a generated source from this conversation using multipart image bytes and saves a new version', async () => {
      const result = await generator.generateImage({ ...request, sourceImage: `generated-image:${id}` });
      if (!('imageSource' in result)) throw new Error('Expected image receipt');
      expect(workspaces.findById).toHaveBeenCalledWith('w', id);
      expect(documentService.openReadStream).toHaveBeenCalledWith('stored/image.png');
      const [endpoint, form, options] = post.mock.calls[0];
      expect(endpoint).toBe('/v1/images/edits');
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('model')).toBe(request.model);
      expect(form.get('prompt')).toBe(request.prompt);
      expect(Buffer.from(await form.get('image').arrayBuffer())).toEqual(png);
      expect(options.headers['Content-Type']).toBe('multipart/form-data');
      expect(workspaces.uploadSmallFile).toHaveBeenCalledTimes(1);
      expect(result.imageSource).toBe(`generated-image:${id}`);
    });
    it('rejects arbitrary paths, foreign source records and oversized source streams before the provider call', async () => {
      await expect(generator.generateImage({ ...request, sourceImage: 'other/private/image.png' })).rejects.toThrow('not found');
      workspaces.findById.mockRejectedValueOnce(new Error('Image not found'));
      await expect(generator.generateImage({ ...request, sourceImage: `generated-image:${id}` })).rejects.toThrow('not found');
      documentService.openReadStream.mockImplementationOnce(async () => ({ body: Readable.from([Buffer.alloc(20 * 1024 * 1024 + 1)]) }));
      await expect(generator.generateImage({ ...request, sourceImage: `generated-image:${id}` })).rejects.toThrow('size limit');
      expect(post).not.toHaveBeenCalled();
    });
    it('sanitizes provider failures and rejects non-image bytes', async () => {
      post.mockRejectedValueOnce(new Error('secret gateway details'));
      await expect(generator.generateImage(request)).rejects.toThrow('Image generation failed; please try again');
      post.mockResolvedValueOnce({ data: { data: [{ b64_json: Buffer.from('not an image').toString('base64') }] } });
      await expect(generator.generateImage(request)).rejects.toThrow('unsupported image');
      expect(workspaces.uploadSmallFile).not.toHaveBeenCalled();
    });
    it('reauthorizes image storage on reload and refuses cross-message references', async () => {
      documentService.generateSasUrl.mockResolvedValue('https://storage.test/fresh');
      expect(await generator.resolveGeneratedImage('c', 'm', id)).toEqual({ url: 'https://storage.test/fresh',
        fileName: 'generated-test.png', mimeType: 'image/png', generated: true });
      expect(workspaces.findById).toHaveBeenCalledWith('w', id);
      await expect(generator.resolveGeneratedImage('other', 'm', id)).rejects.toThrow('not found');
      await expect(generator.resolveGeneratedImage('c', 'm', '000000000000000000000000')).rejects.toThrow('not found');
    });
    it('forwards cancellation to the provider and never publishes an aborted result', async () => {
      const controller = new AbortController();
      post.mockImplementationOnce(async () => {
        controller.abort();
        return { data: { data: [{ b64_json: png.toString('base64') }] } };
      });
      await expect(generator.generateImage(request, controller.signal)).rejects.toThrow();
      expect(post).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.objectContaining({ signal: controller.signal }));
      expect(workspaces.uploadSmallFile).not.toHaveBeenCalled();
    });
    it('imports an accessible uploaded image without generation and preserves the original for direct edits', async () => {
      const reused = await generator.generateImage({ ...request, reuseImage: 'photo.png' });
      expect(reused).toMatchObject({ imageSource: `generated-image:${id}`, generated: false });
      expect(workspaces.findByMultipleWorkspaces).toHaveBeenCalledWith(['allowed', 'w'], expect.objectContaining({ search: 'photo.png' }));
      expect(post).not.toHaveBeenCalled();
      const edited = await generator.generateImage({ ...request, sourceImage: 'photo.png' });
      expect(edited).toMatchObject({ generated: true, originalImageSource: `generated-image:${id}` });
      expect(post).toHaveBeenCalledWith('/v1/images/edits', expect.any(FormData), expect.anything());
    });
    it('rejects raw paths, ambiguous names, incomplete files and inaccessible sources', async () => {
      for (const sourceImage of ['../photo.png', 'allowed/photo.png', 'C:\\photo.png', '.', '..']) {
        await expect(generator.generateImage({ ...request, sourceImage })).rejects.toThrow('not found');
      }
      const doc = { id: 'upload', originalName: 'photo.png', path: 'allowed/photo.png', mimeType: 'image/png', status: 'completed' };
      workspaces.findByMultipleWorkspaces.mockResolvedValueOnce({ documents: [doc, doc], pagination: { total: 2 } });
      await expect(generator.generateImage({ ...request, reuseImage: 'photo.png' })).rejects.toThrow('ambiguous');
      workspaces.findByMultipleWorkspaces.mockResolvedValueOnce({ documents: [{ ...doc, status: 'uploading' }], pagination: { total: 1 } });
      await expect(generator.generateImage({ ...request, reuseImage: 'photo.png' })).rejects.toThrow('not found');
      workspaces.findByMultipleWorkspaces.mockResolvedValueOnce({ documents: [], pagination: { total: 0 } });
      await expect(generator.generateImage({ ...request, reuseImage: 'private.png' })).rejects.toThrow('not found');
      expect(post).not.toHaveBeenCalled();
      expect(documentService.copy).not.toHaveBeenCalled();
    });
    it('bounds uploaded source metadata and actual stream bytes before import', async () => {
      const doc = { id: 'upload', originalName: 'photo.png', path: 'allowed/photo.png', mimeType: 'image/png', status: 'completed' };
      workspaces.findByMultipleWorkspaces.mockResolvedValueOnce({ documents: [{ ...doc, size: 20 * 1024 * 1024 + 1 }], pagination: { total: 1 } });
      await expect(generator.generateImage({ ...request, reuseImage: 'photo.png' })).rejects.toThrow('size limit');
      documentService.openReadStream.mockImplementationOnce(async () => ({ body: Readable.from([Buffer.alloc(20 * 1024 * 1024 + 1)]) }));
      await expect(generator.generateImage({ ...request, reuseImage: 'photo.png' })).rejects.toThrow('size limit');
      workspaces.findByMultipleWorkspaces.mockResolvedValueOnce({ documents: [{ ...doc, mimeType: 'text/html' }], pagination: { total: 1 } });
      await expect(generator.generateImage({ ...request, reuseImage: 'photo.png' })).rejects.toThrow('Unsupported');
      await expect(generator.generateImage({ ...request, reuseImage: 'photo.png', preparedImage: png.toString('base64') })).rejects.toThrow('requires a PDF');
      expect(workspaces.uploadSmallFile).not.toHaveBeenCalled();
    });
    it('imports public HTTPS images only through pinned guarded downloads with MIME and magic checks', async () => {
      const url = 'https://images.example/photo.png';
      expect(await generator.generateImage({ ...request, reuseImage: url })).toMatchObject({ generated: false });
      expect(downloader.assertUrlIsSafe).toHaveBeenCalledWith(url);
      expect(downloader.download).toHaveBeenCalledWith(url, { maxBytes: 20971520, deadlineMs: 15000, pinDns: true });
      await expect(generator.generateImage({ ...request, reuseImage: 'https://user:password@images.example/photo.png' })).rejects.toThrow('Invalid image URL');
      downloader.assertUrlIsSafe.mockRejectedValueOnce(new Error('Blocked private address'));
      await expect(generator.generateImage({ ...request, reuseImage: 'https://127.0.0.1/photo.png' })).rejects.toThrow('Blocked');
      downloader.download.mockResolvedValueOnce({ data: png, headers: { 'content-type': 'text/html' } });
      await expect(generator.generateImage({ ...request, reuseImage: url })).rejects.toThrow('Unsupported source image');
      downloader.download.mockResolvedValueOnce({ data: Buffer.from('html'), headers: { 'content-type': 'image/png' } });
      await expect(generator.generateImage({ ...request, reuseImage: url })).rejects.toThrow('Unsupported source image');
      downloader.download.mockResolvedValueOnce({ data: Buffer.alloc(20 * 1024 * 1024 + 1), headers: { 'content-type': 'image/png' } });
      await expect(generator.generateImage({ ...request, reuseImage: url })).rejects.toThrow('Unsupported source image');
    });
    it('prepares only authorized PDFs and reauthorizes the internal raster roundtrip before import', async () => {
      const pdf = Buffer.from('%PDF-1.7\nfixture');
      workspaces.findByMultipleWorkspaces.mockResolvedValue({ documents: [{ id: 'pdf', originalName: 'chart.pdf',
        path: 'allowed/chart.pdf', mimeType: 'application/pdf', size: pdf.length, status: 'completed' }], pagination: { total: 1 } });
      documentService.openReadStream.mockImplementation(async () => ({ body: Readable.from([pdf]) }));
      const input = { ...request, reuseImage: 'chart.pdf', sourcePage: 2 };
      expect(await generator.generateImage(input)).toEqual({ sourcePdf: pdf.toString('base64'), mimeType: 'application/pdf', page: 2 });
      expect(post).not.toHaveBeenCalled();
      expect(workspaces.uploadSmallFile).not.toHaveBeenCalled();
      expect(await generator.generateImage({ ...input, preparedImage: png.toString('base64') })).toMatchObject({ generated: false });
      expect(workspaces.findByMultipleWorkspaces).toHaveBeenCalledTimes(2);
      workspaces.findByMultipleWorkspaces.mockResolvedValueOnce({ documents: [], pagination: { total: 0 } });
      await expect(generator.generateImage({ ...input, preparedImage: png.toString('base64') })).rejects.toThrow('not found');
      await expect(generator.generateImage({ ...input, preparedImage: Buffer.from('bad').toString('base64') })).rejects.toThrow('Unsupported source image');
      await expect(generator.generateImage({ ...input, sourcePage: 0 })).rejects.toThrow('Invalid PDF');
    });
    it('does not label imported originals as generated after reload', async () => {
      workspaces.findById.mockResolvedValueOnce({ id, originalName: 'generated-import-original.png', path: 'stored/image.png', mimeType: 'image/png' });
      documentService.generateSasUrl.mockResolvedValue('https://storage.test/import');
      expect(await generator.resolveGeneratedImage('c', 'm', id)).toMatchObject({ generated: false });
      workspaces.findById.mockResolvedValueOnce({ id, originalName: 'generated-import-original.png', path: 'stored/image.png', mimeType: 'image/png' });
      expect(await generator.generateImage({ ...request, reuseImage: `generated-image:${id}` })).toMatchObject({ generated: false });
      expect(workspaces.uploadSmallFile).not.toHaveBeenCalled();
    });
  });

  it('uses the canonical Wikimedia image host only after checking the original saved URL', async () => {
    const downloader = { assertUrlIsSafe: jest.fn(), download: jest.fn().mockResolvedValue({ data: Buffer.from('image'), headers: { 'content-type': 'image/jpeg' } }) };
    const exporter = new ConversationArtifactService(messageService as never, documentService as never, conversationService as never, workspaceDocumentService as never, undefined, undefined, downloader as never);
    const url = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/test.jpg?utm_source=search&_=123&width=960';
    messageService.getMessageDocument.mockResolvedValue({ conversationId: 'c', conversationType: 'ai', content: `root = Presentation({title: "Japan"}, ["${url}"])` });
    await exporter.resolveSlideImage('c', 'm', url);
    expect(downloader.assertUrlIsSafe).toHaveBeenCalledWith('https://upload.wikimedia.org/wikipedia/commons/thumb/test.jpg?width=960');
    expect(downloader.download).toHaveBeenCalledWith('https://upload.wikimedia.org/wikipedia/commons/thumb/test.jpg?width=960', expect.objectContaining({ pinDns: true }));
    await expect(exporter.resolveSlideImage('c', 'm', 'https://upload.wikimedia.org/wikipedia/commons/thumb/test.jpg?width=960')).rejects.toThrow('not found');
    expect(downloader.download).toHaveBeenCalledTimes(1);
  });

  it('exports only HTTPS images referenced by the owned AI answer through the guarded downloader', async () => {
    const downloader = { assertUrlIsSafe: jest.fn(), download: jest.fn().mockResolvedValue({ data: Buffer.from('image'), headers: { 'content-type': 'image/png' } }) };
    const exporter = new ConversationArtifactService(messageService as never, documentService as never, conversationService as never, workspaceDocumentService as never, undefined, undefined, downloader as never);
    const url = 'https://photos.example/japan.png';
    messageService.getMessageDocument.mockResolvedValue({ conversationId: 'c', conversationType: 'ai', components: [{ data: { content: `root = Presentation({title: "Japan"}, [s1])\ns1 = Slide("s1", Image("${url}"))` } }] });
    expect(await exporter.resolveSlideImage('c', 'm', url)).toEqual({ dataUrl: 'data:image/png;base64,aW1hZ2U=' });
    expect(downloader.assertUrlIsSafe).toHaveBeenCalledWith(url);
    expect(downloader.download).toHaveBeenCalledWith(url, { maxBytes: 20971520, deadlineMs: 15000, pinDns: true });
    await expect(exporter.resolveSlideImage('other', 'm', url)).rejects.toThrow('not found');
    await expect(exporter.resolveSlideImage('c', 'm', 'https://photos.example/other.png')).rejects.toThrow('not found');
    expect(downloader.download).toHaveBeenCalledTimes(1);
    downloader.assertUrlIsSafe.mockRejectedValueOnce(new Error('Blocked private address'));
    await expect(exporter.resolveSlideImage('c', 'm', url)).rejects.toThrow('Blocked');
    downloader.download.mockResolvedValueOnce({ data: Buffer.from('html'), headers: { 'content-type': 'text/html' } });
    await expect(exporter.resolveSlideImage('c', 'm', url)).rejects.toThrow('Invalid image type');
  });

  it('resolves governed citations only through the current pinned scope, without ordinary workspace expansion', async () => {
    const runtime = { resolveRuntime: jest.fn().mockResolvedValue({ workspaceIds: ['approved'] }) };
    const governed = new ConversationArtifactService(messageService as never, documentService as never,
      conversationService as never, workspaceDocumentService as never, undefined, runtime as never);
    messageService.getMessageDocument.mockResolvedValue({ conversationId: 'conversation',
      components: [{ type: 'citation', data: { source: 'guide.pdf', reference: '1', workspaceId: 'approved' } }] });
    const conversation = { runtimeMode: 'governed', createdBy: 'viewer', governanceContext: { revisionId: 'pinned' },
      workspaces: ['unapproved'], systemWorkspaceId: 'unapproved-system' };
    conversationService.getConversationDocument.mockResolvedValue(conversation);
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({ documents: [{
      originalName: 'guide.pdf', filename: 'guide.pdf', path: 'approved/guide.pdf', mimeType: 'application/pdf', isFolder: false }],
      pagination: { total: 1 } });
    documentService.generateSasUrl.mockResolvedValue('https://storage.test/current');
    expect(await governed.resolveCitationUrl('conversation', 'message', { source: 'guide.pdf', reference: '1' }, 'viewer'))
      .toMatchObject({ fileName: 'guide.pdf' });
    expect(workspaceDocumentService.findByMultipleWorkspaces).toHaveBeenCalledWith(['approved'], expect.anything());
    expect(runtime.resolveRuntime).toHaveBeenCalledTimes(2);
    expect(conversationService.filterAccessibleWorkspaceIds).not.toHaveBeenCalled();
    runtime.resolveRuntime.mockRejectedValueOnce(new Error('Scope revoked'));
    await expect(governed.resolveCitationUrl('conversation', 'message', { source: 'guide.pdf' }, 'viewer')).rejects.toThrow('revoked');
    runtime.resolveRuntime.mockResolvedValueOnce({ workspaceIds: ['approved'] }).mockRejectedValueOnce(new Error('Late revocation'));
    await expect(governed.resolveCitationUrl('conversation', 'message', { source: 'guide.pdf' }, 'viewer')).rejects.toThrow('Late revocation');
  });

  it('resolves a published delegate artifact through its original producer and current viewer', async () => {
    const rootEvidence = { resolve: jest.fn().mockResolvedValue({ kind: 'artifact', url: 'https://storage.test/current', fileName: 'result.txt' }) };
    const owned = new ConversationArtifactService(messageService as never, documentService as never,
      conversationService as never, workspaceDocumentService as never, rootEvidence as never);
    messageService.getMessageDocument.mockResolvedValue({ conversationId: 'conversation', components: [{ type: 'artifact',
      data: { artifactId: 'original-artifact', evidenceId: 'stable-evidence', executionId: 'producer' } }] });
    expect(await owned.resolveDownloadUrl('conversation', 'followup-message', 'original-artifact', 'viewer'))
      .toEqual({ viewUrl: 'https://storage.test/current', downloadUrl: 'https://storage.test/current' });
    expect(rootEvidence.resolve).toHaveBeenCalledWith('conversation', 'producer', 'stable-evidence', 'viewer');
    await expect(owned.resolveDownloadUrl('conversation', 'followup-message', 'original-artifact')).rejects.toThrow('not found');
    rootEvidence.resolve.mockRejectedValueOnce(new Error('current producer grant revoked'));
    await expect(owned.resolveDownloadUrl('conversation', 'followup-message', 'original-artifact', 'viewer')).rejects.toThrow('revoked');
    expect(documentService.generateSasUrl).not.toHaveBeenCalled();
  });

  it('uses publication aliases to distinguish sibling-local citations without broadening conversation sources', async () => {
    const rootEvidence = { resolve: jest.fn().mockResolvedValue({ kind: 'citation', url: 'https://storage.test/current',
      fileName: 'private.pdf', mimeType: 'application/pdf' }) };
    const owned = new ConversationArtifactService(messageService as never, documentService as never,
      conversationService as never, workspaceDocumentService as never, rootEvidence as never);
    messageService.getMessageDocument.mockResolvedValue({ conversationId: 'conversation', components: [
      { type: 'citation', data: { source: 'private.pdf', fileName: 'private.pdf', reference: '1', evidenceId: 'first', executionId: 'producer-one' } },
      { type: 'citation', data: { source: 'private.pdf', fileName: 'private.pdf', reference: '2', evidenceId: 'second', executionId: 'producer-two' } },
    ] });
    expect(await owned.resolveCitationUrl('conversation', 'followup-message', { source: 'private.pdf', reference: '2' }, 'viewer'))
      .toMatchObject({ mimeType: 'application/pdf', fileName: 'private.pdf' });
    expect(rootEvidence.resolve).toHaveBeenCalledWith('conversation', 'producer-two', 'second', 'viewer');
    await expect(owned.resolveCitationUrl('conversation', 'followup-message', { source: 'private.pdf' }, 'viewer')).rejects.toThrow('not found');
    expect(workspaceDocumentService.findByMultipleWorkspaces).not.toHaveBeenCalled();
    expect(conversationService.filterAccessibleWorkspaceIds).not.toHaveBeenCalled();
  });

  it('projects recent ready artifacts without storage paths', async () => {
    messageService.listRecentArtifactMessages.mockResolvedValue([{
      id: 'message-1', conversationId: 'conversation-1', conversationTitle: 'Quarterly review', updatedAt: new Date('2026-09-13T10:00:00Z'),
      components: [{ type: 'artifact', data: { artifactId: 'artifact-1', filename: 'review.pdf', artifactKind: 'document', mimeType: 'application/pdf', storagePath: 'private/path' } }],
    }]);

    const result = await service.listRecent('user-1', 6);
    expect(result).toEqual([expect.objectContaining({ artifactId: 'artifact-1', filename: 'review.pdf', conversationId: 'conversation-1' })]);
    expect(JSON.stringify(result)).not.toContain('private/path');
  });

  it('resolves a persisted artifact by scoped opaque identity', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'artifact', data: { artifactId: 'artifact-1', filename: 'report.pdf', storagePath: 'owner/system_run/report.pdf' } }],
    });
    documentService.generateSasUrl
      .mockResolvedValueOnce('https://storage.example/view-report')
      .mockResolvedValueOnce('https://storage.example/download-report');

    await expect(service.resolveDownloadUrl('conversation-1', 'message-1', 'artifact-1')).resolves.toEqual({
      viewUrl: 'https://storage.example/view-report',
      downloadUrl: 'https://storage.example/download-report',
    });
    expect(documentService.generateSasUrl).toHaveBeenNthCalledWith(1, 'owner/system_run/report.pdf', {
      expiryMinutes: 10,
      checkExists: true,
    });
    expect(documentService.generateSasUrl).toHaveBeenNthCalledWith(2, 'owner/system_run/report.pdf', expect.objectContaining({
      expiryMinutes: 10,
      checkExists: true,
      contentDisposition: 'attachment; filename="report.pdf"',
    }));
  });

  it('does not resolve artifacts from another conversation', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-2' },
      components: [],
    });

    await expect(service.resolveDownloadUrl('conversation-1', 'message-1', 'artifact-1')).rejects.toMatchObject({ status: 404 });
    expect(documentService.generateSasUrl).not.toHaveBeenCalled();
  });

  it('resolves a persisted citation alias through conversation workspaces', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'citation', data: { source: 'deepsearch', fileName: 'report.pdf', sourceType: 'text' } }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{ originalName: 'report.pdf', filename: 'stored-report.pdf', mimeType: 'application/pdf', path: 'owner/workspace/report.pdf', isFolder: false }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/report');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'deepsearch', fileName: 'report.pdf',
    })).resolves.toEqual({ url: 'https://storage.example/report', fileName: 'report.pdf', mimeType: 'application/pdf' });
    expect(documentService.generateSasUrl).toHaveBeenCalledWith('owner/workspace/report.pdf', {
      expiryMinutes: 10,
      checkExists: true,
    });
  });

  it('does not resolve a citation from a workspace the requester cannot access', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'citation', data: { source: 'deepsearch', fileName: 'report.pdf', workspaceId: 'workspace-1' } }],
    });
    conversationService.getConversationDocument.mockResolvedValue({ workspaces: ['workspace-1'] });
    conversationService.filterAccessibleWorkspaceIds.mockResolvedValueOnce([]);

    await expect(service.resolveCitationUrl(
      'conversation-1',
      'message-1',
      { source: 'deepsearch', fileName: 'report.pdf' },
      'recipient-1',
    )).rejects.toMatchObject({ status: 404 });
    expect(workspaceDocumentService.findByMultipleWorkspaces).not.toHaveBeenCalled();
  });

  it('resolves a redacted selector by its persisted filename and reference', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{
        type: 'citation',
        data: { source: 'deepsearch', fileName: 'report.pdf', reference: '[7]', workspaceId: 'workspace-1' },
      }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }, { toString: () => 'workspace-2' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{ originalName: 'report.pdf', mimeType: 'application/pdf', path: 'owner/one/report.pdf', isFolder: false }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/report');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: '[REDACTED]', fileName: 'report.pdf', reference: '7',
    })).resolves.toMatchObject({ fileName: 'report.pdf' });
    expect(workspaceDocumentService.findByMultipleWorkspaces).toHaveBeenCalledWith(
      ['workspace-1'],
      { search: 'report.pdf', page: 1, limit: 100, searchFilename: true },
    );
  });

  it('matches citations that name the storage filename when the original name differs', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{
        type: 'citation',
        data: {
          source: 'owner/bpce-summit/FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
          fileName: 'FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
        },
      }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{
        originalName: 'FP PRET EMPRUNT TEC10_CHROME_v1.pdf',
        filename: 'FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
        mimeType: 'application/pdf',
        path: 'owner/ws/FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
        isFolder: false,
      }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/doc');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'owner/bpce-summit/FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
      fileName: 'FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
    })).resolves.toMatchObject({ fileName: 'FP PRET EMPRUNT TEC10_CHROME_v1.pdf' });
    expect(workspaceDocumentService.findByMultipleWorkspaces).toHaveBeenCalledWith(
      ['workspace-1'],
      { search: 'FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf', page: 1, limit: 100, searchFilename: true },
    );
  });

  it('resolves a legacy source-only citation', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'citation', data: { source: 'owner/workspace/legacy.pdf' } }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{ originalName: 'legacy.pdf', mimeType: 'application/pdf', path: 'owner/workspace/legacy.pdf', isFolder: false }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/legacy');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'owner/workspace/legacy.pdf',
    })).resolves.toMatchObject({ fileName: 'legacy.pdf' });
  });

  it('resolves a filename-less flat image citation by its path', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{
        type: 'citation',
        data: { sourceType: 'image', path: 'owner/workspace/chart.png', workspaceId: 'workspace-1' },
      }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{ originalName: 'chart.png', mimeType: 'image/png', path: 'owner/workspace/chart.png', isFolder: false }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/chart');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'owner/workspace/chart.png',
    })).resolves.toEqual({
      url: 'https://storage.example/chart', fileName: 'chart.png', mimeType: 'image/png',
    });
  });

  it('accepts repeated components with the same persisted citation identity', async () => {
    const citation = {
      type: 'citation',
      data: { source: 'deepsearch', fileName: 'report.pdf', reference: '[7]', workspaceId: 'workspace-1' },
    };
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [citation, citation],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{ originalName: 'report.pdf', mimeType: 'application/pdf', path: 'owner/one/report.pdf', isFolder: false }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/report');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: '[REDACTED]', fileName: 'report.pdf', reference: '7',
    })).resolves.toMatchObject({ fileName: 'report.pdf' });
  });

  it('does not resolve a selector absent from the scoped message', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'citation', data: { source: 'deepsearch', fileName: 'report.pdf' } }],
    });

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'another-source', fileName: 'another-report.pdf',
    })).rejects.toMatchObject({ status: 404 });
    expect(workspaceDocumentService.findByMultipleWorkspaces).not.toHaveBeenCalled();
  });

  it('rejects ambiguous exact filename matches across allowed workspaces', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'citation', data: { source: 'deepsearch', fileName: 'report.pdf' } }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }, { toString: () => 'workspace-2' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [
        { originalName: 'report.pdf', path: 'owner/one/report.pdf', isFolder: false },
        { originalName: 'report.pdf', path: 'owner/two/report.pdf', isFolder: false },
      ],
      pagination: { total: 2 },
    });

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'deepsearch', fileName: 'report.pdf',
    })).rejects.toMatchObject({ status: 404 });
    expect(documentService.generateSasUrl).not.toHaveBeenCalled();
  });

  it('rejects duplicate persisted filenames with different workspace identities', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [
        { type: 'citation', data: { source: 'one/report.pdf', fileName: 'report.pdf', workspaceId: 'workspace-1' } },
        { type: 'citation', data: { source: 'two/report.pdf', fileName: 'report.pdf', workspaceId: 'workspace-2' } },
      ],
    });

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: '[REDACTED]', fileName: 'report.pdf',
    })).rejects.toMatchObject({ status: 404 });
    expect(conversationService.getConversationDocument).not.toHaveBeenCalled();
    expect(documentService.generateSasUrl).not.toHaveBeenCalled();
  });

  it('rejects a persisted citation workspace outside the conversation scope', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{
        type: 'citation',
        data: { source: 'deepsearch', fileName: 'report.pdf', workspaceId: 'workspace-2' },
      }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: '[REDACTED]', fileName: 'report.pdf',
    })).rejects.toMatchObject({ status: 404 });
    expect(workspaceDocumentService.findByMultipleWorkspaces).not.toHaveBeenCalled();
  });
});
