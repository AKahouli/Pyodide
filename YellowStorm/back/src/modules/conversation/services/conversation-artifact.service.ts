import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ModelsService } from '../../models/models.service';
import { LiteLLMConnectionService } from '../../models/litellm-connection.service';
import { AgentService } from '../../agent/agent.service';
import { ToolService } from '../../tool/tool.service';
import { GenerateConversationImageDto } from '../dto/generate-conversation-image.dto';
import { DocumentService } from '../../document/document.service';
import { NotFoundException, ServiceUnavailableException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { ResolveCitationUrlDto } from '../dto/resolve-citation-url.dto';
import { RootEvidenceService } from '../root-work/root-evidence.service';
import { GovernedConversationRuntimeService } from '../../governance/services/governed-conversation-runtime.service';
import { GuardedUrlDownloaderService } from '../../workspace/services/guarded-url-downloader.service';
import { BadRequestException } from '../../exceptions';
import { DocumentStatus } from '../../workspace/interfaces/document-status.enum';

type ImageReceipt = { imageSource: string; fileName: string; mimeType: string; generated: boolean;
  sandboxPath: string; originalImageSource?: string };
type PreparedPdfSource = { sourcePdf: string; mimeType: 'application/pdf'; page: number };
type StoredImage = { id: string; path?: string; originalName: string; mimeType: string };
type ImageVersion = { source: string; fileName: string; createdAt: string; generated: boolean; parentSource?: string };

@Injectable()
export class ConversationArtifactService {
  constructor(
    private readonly messageService: MessageService,
    private readonly documentService: DocumentService,
    private readonly conversationService: ConversationService,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly rootEvidence?: RootEvidenceService,
    @Optional() private readonly governedRuntime?: GovernedConversationRuntimeService,
    @Optional() private readonly imageDownloader?: GuardedUrlDownloaderService,
    @Optional() private readonly models?: ModelsService,
    @Optional() private readonly imageGateway?: LiteLLMConnectionService,
    @Optional() @Inject(forwardRef(() => AgentService)) private readonly agents?: AgentService,
    @Optional() private readonly tools?: ToolService,
  ) {}

  async generateImage(request: GenerateConversationImageDto, signal?: AbortSignal): Promise<ImageReceipt | PreparedPdfSource> {
    const conversation = await this.conversationService.getConversationDocument(request.conversationId);
    const member = conversation.isGroup && conversation.members?.some(item => item.userId === request.userId);
    if (conversation.createdBy !== request.userId && !member) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    }
    if (conversation.runtimeMode === 'governed') {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Image generation is unavailable in governed conversations');
    }
    const agent = (await this.agents?.findByIds([request.agentId], request.userId))?.[0];
    const tool = (await this.tools?.findAllActive())?.find(item => item.name === 'generate_image'
      && agent && (agent.tools.includes(item.id) || item.defaultAgentTypes.includes(agent.agentType.slug)));
    const configuredModel = tool?.attributes.find(item => item.name === 'model')?.value ?? 'gpt-image-2.5-flare';
    if (!agent?.isActive || !tool || configuredModel !== request.model) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Image generation is not enabled for this agent');
    }
    if (request.reuseImage !== undefined && request.sourceImage !== undefined) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Choose either image editing or reuse');
    }
    const reference = request.reuseImage ?? request.sourceImage;
    if (reference !== undefined && typeof reference !== 'string') {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid image source');
    }
    const source = reference !== undefined ? await this.prepareImageSource(request, conversation, reference, signal) : undefined;
    if (source && 'sourcePdf' in source) return source;
    if (request.reuseImage !== undefined && source) return this.stageGeneratedImage(request, source.document, signal);
    if (request.preparedImage !== undefined && reference === undefined) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Prepared image requires a PDF source');
    }
    const model = await this.models?.findById(request.model);
    if (!model?.isActive || !(model.type === 'image_generation' || model.types.includes('image_generation'))) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Select an active image generation model');
    }
    const client = this.imageGateway?.getHttpClient();
    if (!client || !this.documentService.isAvailable()) {
      throw new ServiceUnavailableException(undefined, 'Image generation unavailable');
    }
    const size = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' }[request.aspectRatio];
    let payload: FormData | Record<string, string | number> = {
      model: request.model, prompt: request.prompt, n: 1, size, user: request.userId,
    };
    if (request.sourceImage !== undefined) {
      const form = new FormData();
      for (const [key, value] of Object.entries(payload)) form.append(key, String(value));
      form.append('image', new Blob([new Uint8Array(source!.bytes)], { type: source!.document.mimeType }), source!.document.originalName);
      payload = form;
    }
    signal?.throwIfAborted();
    let encoded: unknown;
    try {
      const response = await client.post<{ data?: { b64_json?: unknown }[] }>(
        request.sourceImage ? '/v1/images/edits' : '/v1/images/generations', payload,
        { signal, timeout: 180_000, maxContentLength: 28 * 1024 * 1024,
          maxBodyLength: request.sourceImage ? 21 * 1024 * 1024 : 64 * 1024,
          ...(request.sourceImage ? { headers: { 'Content-Type': 'multipart/form-data' } } : {}) });
      encoded = response.data.data?.[0]?.b64_json;
    } catch {
      // Provider errors may include credentials or signed URLs. Keep them out of the stream.
      throw new ServiceUnavailableException(undefined, 'Image generation failed; please try again');
    }
    if (typeof encoded !== 'string' || encoded.length > 28 * 1024 * 1024
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Image model returned invalid image data');
    }
    const bytes = Buffer.from(encoded, 'base64');
    const mimeType = this.imageMimeType(bytes);
    if (!mimeType || bytes.length > 20 * 1024 * 1024) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Image model returned an unsupported image');
    }
    signal?.throwIfAborted();
    const workspaceId = await this.conversationService.ensureSystemWorkspace(conversation.createdBy, request.conversationId);
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mimeType];
    const fileName = `generated-${randomUUID()}.${extension}`;
    signal?.throwIfAborted();
    const document = await this.workspaceDocumentService.uploadSmallFile(workspaceId, request.userId,
      bytes, fileName, mimeType, undefined, undefined, false);
    if (source && source.document.id !== document.id) {
      await this.workspaceDocumentService.mergeMetadata(workspaceId, document.id, { imageParentId: source.document.id });
    }
    const receipt = await this.stageGeneratedImage(request, { ...document, originalName: fileName, mimeType }, signal);
    return source?.imported ? { ...receipt, originalImageSource: `generated-image:${source.document.id}` } : receipt;
  }

  private imageMimeType(bytes: Buffer): string {
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : '';
  }

  private async prepareImageSource(request: GenerateConversationImageDto,
    conversation: Awaited<ReturnType<ConversationService['getConversationDocument']>>, reference: string,
    signal?: AbortSignal): Promise<{ document: StoredImage; bytes: Buffer; imported: boolean } | PreparedPdfSource> {
    signal?.throwIfAborted();
    if (reference.startsWith('generated-image:')) {
      if (request.preparedImage !== undefined) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Prepared image requires a PDF source');
      const document = await this.findGeneratedImage(conversation.systemWorkspaceId, reference);
      const bytes = await this.readGeneratedImage(document.path, signal);
      if (this.imageMimeType(bytes) !== document.mimeType) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid source image');
      return { document, bytes, imported: false };
    }
    let bytes: Buffer;
    let mimeType: string;
    if (reference.startsWith('https://')) {
      if (request.preparedImage !== undefined) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Prepared image requires a PDF source');
      let parsed: URL;
      try { parsed = new URL(reference); } catch { throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid image URL'); }
      if (/[\x00-\x20\x7f]/.test(reference) || parsed.username || parsed.password || parsed.protocol !== 'https:' || !this.imageDownloader) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid image URL');
      }
      if (parsed.hostname === 'thumb.wikimedia.org') {
        parsed.hostname = 'upload.wikimedia.org';
        for (const key of [...parsed.searchParams.keys()]) if (key === '_' || key.startsWith('utm_')) parsed.searchParams.delete(key);
      }
      await this.imageDownloader.assertUrlIsSafe(parsed.href);
      const download = await this.imageDownloader.download(parsed.href,
        { maxBytes: 20 * 1024 * 1024, deadlineMs: 15000, pinDns: true });
      bytes = download.data;
      mimeType = String(download.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    } else {
      if (!reference || /[\\/:\x00-\x1f\x7f]/.test(reference) || !/\.(png|jpe?g|webp|pdf)$/i.test(reference)) {
        throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image not found');
      }
      const allowed = await this.conversationService.filterAccessibleWorkspaceIds(request.userId,
        (conversation.workspaces ?? []).map(id => id.toString()));
      const workspaceIds = [...new Set([...allowed, ...(conversation.systemWorkspaceId ? [conversation.systemWorkspaceId.toString()] : [])])];
      if (!workspaceIds.length) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image not found');
      const result = await this.workspaceDocumentService.findByMultipleWorkspaces(workspaceIds,
        { search: reference, page: 1, limit: 100, searchFilename: true });
      const matches = result.documents.filter(document => !document.isFolder && document.path
        && document.status === DocumentStatus.COMPLETED
        && (document.originalName === reference || document.filename === reference));
      if (matches.length !== 1 || result.pagination.total > result.documents.length) {
        throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image not found or ambiguous filename');
      }
      const document = matches[0];
      if (document.size > 20 * 1024 * 1024) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Image exceeds size limit');
      mimeType = document.mimeType;
      if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(mimeType)) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Unsupported source image');
      }
      bytes = await this.readGeneratedImage(document.path!, signal);
      if (mimeType === 'application/pdf') {
        const page = request.sourcePage ?? 1;
        if (!Number.isInteger(page) || page < 1 || page > 5000 || bytes.toString('ascii', 0, 5) !== '%PDF-') {
          throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid PDF source');
        }
        if (request.preparedImage === undefined) return { sourcePdf: bytes.toString('base64'), mimeType: 'application/pdf', page };
        const encoded = request.preparedImage;
        if (encoded.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
          throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid prepared image');
        }
        bytes = Buffer.from(encoded, 'base64');
        if (bytes.length > 6 * 1024 * 1024) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Prepared image exceeds size limit');
        mimeType = 'image/png';
      } else if (request.preparedImage !== undefined) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Prepared image requires a PDF source');
      }
    }
    if (!bytes.length || bytes.length > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)
        || this.imageMimeType(bytes) !== mimeType) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Unsupported source image');
    }
    signal?.throwIfAborted();
    const workspaceId = await this.conversationService.ensureSystemWorkspace(conversation.createdBy, request.conversationId);
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mimeType];
    const originalName = `generated-import-${randomUUID()}.${extension}`;
    const document = await this.workspaceDocumentService.uploadSmallFile(workspaceId, request.userId,
      bytes, originalName, mimeType, undefined, undefined, false);
    return { document: { ...document, originalName, mimeType }, bytes, imported: true };
  }

  private async findGeneratedImage(workspaceId: string | undefined, reference: string): Promise<
    Awaited<ReturnType<WorkspaceDocumentService['findById']>> & { path: string }
  > {
    const match = /^generated-image:([a-f0-9]{24})$/.exec(reference);
    if (!match || !workspaceId) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image not found');
    const source = await this.workspaceDocumentService.findById(workspaceId, match[1]);
    if (source.isFolder || !source.path || !source.originalName.startsWith('generated-')
        || !['image/png', 'image/jpeg', 'image/webp'].includes(source.mimeType) || source.size > 20 * 1024 * 1024) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image not found');
    }
    return { ...source, path: source.path };
  }

  private async stageGeneratedImage(request: GenerateConversationImageDto,
    image: StoredImage, signal?: AbortSignal): Promise<ImageReceipt> {
    signal?.throwIfAborted();
    if (!image.path) throw new ServiceUnavailableException(undefined, 'Image file unavailable');
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[image.mimeType];
    const relativePath = `generated-images/${image.id}.${extension}`;
    // MCP mounts the existing run folder; the runtime verifies staged paths before use.
    const runFolder = `system_${request.conversationId}`;
    await this.documentService.copy(image.path, `${request.userId}/${runFolder}/${relativePath}`);
    signal?.throwIfAborted();
    return { imageSource: `generated-image:${image.id}`, fileName: image.originalName, mimeType: image.mimeType,
      generated: !image.originalName.startsWith('generated-import-'), sandboxPath: `/mnt/workspace/${relativePath}` };
  }

  private async readGeneratedImage(path: string, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    const stream = await this.documentService.openReadStream(path);
    const abort = () => stream.body.destroy(new Error('Image read cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream.body) {
        signal?.throwIfAborted();
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 20 * 1024 * 1024) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Image exceeds size limit');
        chunks.push(buffer);
      }
      if (!size) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Image is empty');
      return Buffer.concat(chunks);
    } finally {
      signal?.removeEventListener('abort', abort);
      stream.body.destroy();
    }
  }

  async resolveGeneratedImage(conversationId: string, messageId: string, documentId: string): Promise<{
    url: string; fileName: string; mimeType: string; generated: boolean;
  }> {
    if (!/^[a-f0-9]{24}$/.test(documentId)) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image not found');
    const message = await this.messageService.getMessageDocument(messageId);
    const source = `generated-image:${documentId}`;
    const programs = [message.content, ...(message.components ?? []).map(component => component.data.content)];
    if (message.conversationId.toString() !== conversationId || message.conversationType !== 'ai'
      || !programs.some(content => typeof content === 'string' && content.includes(source))) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image not found');
    }
    const conversation = await this.conversationService.getConversationDocument(conversationId);
    if (!conversation.systemWorkspaceId || conversation.runtimeMode === 'governed') {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image not found');
    }
    const document = await this.workspaceDocumentService.findById(conversation.systemWorkspaceId, documentId);
    if (document.isFolder || !document.path || !document.originalName.startsWith('generated-')
        || !['image/png', 'image/jpeg', 'image/webp'].includes(document.mimeType)) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image not found');
    }
    return { url: await this.documentService.generateSasUrl(document.path, { expiryMinutes: 10, checkExists: true }),
      fileName: document.originalName, mimeType: document.mimeType, generated: !document.originalName.startsWith('generated-import-') };
  }

  async resolveGeneratedImageHistory(conversationId: string, messageId: string, documentId: string,
    versionSource?: string): Promise<{ versions: ImageVersion[]; selected: ImageVersion & { url: string; mimeType: string } }> {
    // Reuse the saved-answer authorization before enumerating any image metadata.
    const anchor = await this.resolveGeneratedImage(conversationId, messageId, documentId);
    const conversation = await this.conversationService.getConversationDocument(conversationId);
    const workspaceId = conversation.systemWorkspaceId!;
    // ponytail: bounded conversation scan; add an indexed lineage query if a
    // conversation needs more than 1,000 saved images. Never return partial history.
    const result = await this.workspaceDocumentService.findByMultipleWorkspaces([workspaceId],
      { search: 'generated-', searchFilename: true, page: 1, limit: 1000 });
    if (result.pagination.total > result.documents.length) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Image history exceeds the supported limit');
    }
    const images = new Map(result.documents.filter(image => image.workspaceId === workspaceId
      && image.status === DocumentStatus.COMPLETED && !image.isFolder && image.path
      && image.originalName.startsWith('generated-') && ['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType))
      .map(image => [image.id, image]));
    const rootOf = (id: string): string | undefined => {
      const seen = new Set<string>();
      while (images.has(id)) {
        if (seen.has(id)) return undefined;
        seen.add(id);
        const parent = images.get(id)!.metadata?.imageParentId;
        if (!parent || !/^[a-f0-9]{24}$/.test(parent) || !images.has(parent)) return id;
        id = parent;
      }
      return undefined;
    };
    const root = rootOf(documentId);
    if (!root) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image history not found');
    const family = [...images.values()].filter(image => rootOf(image.id) === root)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const versions: ImageVersion[] = family.map(image => ({ source: `generated-image:${image.id}`,
      fileName: image.originalName, createdAt: image.createdAt, generated: !image.originalName.startsWith('generated-import-'),
      ...(images.has(image.metadata?.imageParentId ?? '') ? { parentSource: `generated-image:${image.metadata!.imageParentId}` } : {}) }));
    const selectedIndex = versions.findIndex(version => version.source === (versionSource ?? `generated-image:${documentId}`));
    if (selectedIndex < 0) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Image version not found');
    const selected = family[selectedIndex];
    const url = selected.id === documentId ? anchor.url
      : await this.documentService.generateSasUrl(selected.path!, { expiryMinutes: 10, checkExists: true });
    return { versions, selected: { ...versions[selectedIndex], url, mimeType: selected.mimeType } };
  }

  async resolveSlideImage(conversationId: string, messageId: string, url: string): Promise<{ dataUrl: string }> {
    const message = await this.messageService.getMessageDocument(messageId);
    const programs = [message.content, ...(message.components ?? []).map(component => component.data.content)]
      .filter((content): content is string => typeof content === 'string');
    const referenced = programs.some(content => {
      const strings = content.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
      return strings.some(value => { try { return JSON.parse(value) === url; } catch { return false; } });
    });
    if (message.conversationId.toString() !== conversationId || message.conversationType !== 'ai' || !referenced) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Slide image not found');
    }
    if (!this.imageDownloader) throw new ServiceUnavailableException(undefined, 'Image export unavailable');
    const parsed = new URL(url);
    if (parsed.username || parsed.password) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid image URL');
    if (parsed.hostname === 'thumb.wikimedia.org') {
      parsed.hostname = 'upload.wikimedia.org';
      for (const key of [...parsed.searchParams.keys()]) if (key === '_' || key.startsWith('utm_')) parsed.searchParams.delete(key);
    }
    const downloadUrl = parsed.href;
    await this.imageDownloader.assertUrlIsSafe(downloadUrl);
    const image = await this.imageDownloader.download(downloadUrl, { maxBytes: 20 * 1024 * 1024, deadlineMs: 15_000, pinDns: true });
    const type = String(image.headers['content-type'] ?? '').split(';')[0].toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid image type');
    }
    return { dataUrl: `data:${type};base64,${image.data.toString('base64')}` };
  }

  async listRecent(userId: string, limit: number): Promise<{
    source: 'conversation';
    artifactId: string;
    filename: string;
    artifactKind?: string;
    mimeType?: string;
    conversationId: string;
    conversationTitle: string;
    messageId: string;
    generatedAt: string;
  }[]> {
    const messages = await this.messageService.listRecentArtifactMessages(userId, Math.max(limit * 3, 12));
    return messages.flatMap((message) => (message.components ?? [])
      .filter((component) => component.type === 'artifact')
      .map((component) => ({
        source: 'conversation' as const,
        artifactId: typeof component.data?.artifactId === 'string' ? component.data.artifactId : '',
        filename: typeof component.data?.filename === 'string' ? component.data.filename : 'artifact',
        artifactKind: typeof component.data?.artifactKind === 'string' ? component.data.artifactKind : undefined,
        mimeType: typeof component.data?.mimeType === 'string' ? component.data.mimeType : undefined,
        conversationId: message.conversationId,
        conversationTitle: message.conversationTitle,
        messageId: message.id,
        generatedAt: message.updatedAt.toISOString(),
      })))
      .filter((artifact) => artifact.artifactId)
      .slice(0, limit);
  }

  async resolveDownloadUrl(
    conversationId: string,
    messageId: string,
    artifactId: string,
    userId?: string,
  ): Promise<{ viewUrl: string; downloadUrl: string }> {
    const message = await this.messageService.getMessageDocument(messageId);
    if (message.conversationId.toString() !== conversationId) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }
    const component = message.components?.find((candidate) =>
      candidate.type === 'artifact' && candidate.data?.artifactId === artifactId,
    );
    if (component?.data?.evidenceId || component?.data?.executionId) {
      if (!this.rootEvidence || !userId || typeof component.data.evidenceId !== 'string'
        || typeof component.data.executionId !== 'string') {
        throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Artifact not found');
      }
      const location = await this.rootEvidence.resolve(conversationId, component.data.executionId, component.data.evidenceId, userId);
      if (location.kind !== 'artifact') throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Artifact not found');
      return { viewUrl: location.url, downloadUrl: location.url };
    }
    const storagePath = component?.data?.storagePath;
    if (!component || typeof storagePath !== 'string' || !storagePath) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Artifact not found');
    }
    if (!this.documentService.isAvailable()) {
      throw new ServiceUnavailableException(undefined, 'Document service is currently unavailable');
    }
    const filename = typeof component.data.filename === 'string' ? component.data.filename : 'artifact';
    const [viewUrl, downloadUrl] = await Promise.all([
      this.documentService.generateSasUrl(storagePath, {
        expiryMinutes: 10,
        checkExists: true,
      }),
      this.documentService.generateSasUrl(storagePath, {
        expiryMinutes: 10,
        contentDisposition: `attachment; filename="${filename.replace(/["\r\n]/g, '')}"`,
        checkExists: true,
      }),
    ]);
    return { viewUrl, downloadUrl };
  }

  async resolveCitationUrl(
    conversationId: string,
    messageId: string,
    selector: ResolveCitationUrlDto,
    userId?: string,
  ): Promise<{ url: string; fileName: string; mimeType: string }> {
    const message = await this.messageService.getMessageDocument(messageId);
    if (message.conversationId.toString() !== conversationId) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation not found');
    }

    const ownedCitations = (message.components ?? []).filter((component) => component.type === 'citation'
      && (component.data.evidenceId || component.data.executionId)).filter((component) => {
        const citation = this.getCitationIdentity(component.data);
        return (selector.fileName ? citation.fileName === selector.fileName : citation.source === selector.source)
          && (!selector.reference || citation.reference === this.normalizeReference(selector.reference));
      });
    if (ownedCitations.length) {
      const component = ownedCitations[0];
      if (ownedCitations.length !== 1 || !this.rootEvidence || !userId
        || typeof component.data.evidenceId !== 'string' || typeof component.data.executionId !== 'string') {
        throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation not found');
      }
      const location = await this.rootEvidence.resolve(conversationId, component.data.executionId, component.data.evidenceId, userId);
      if (location.kind !== 'citation') throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation not found');
      return { url: location.url, fileName: location.fileName, mimeType: location.mimeType || 'application/octet-stream' };
    }

    const citationCandidates = message.components
      ?.filter((component) => component.type === 'citation')
      .map((component) => this.getCitationIdentity(component.data))
      .filter((citation) => selector.fileName
        ? citation.fileName === selector.fileName
        : citation.source === selector.source)
      .filter((citation) => !selector.reference || citation.reference === this.normalizeReference(selector.reference)) || [];
    const uniqueCitations = new Map(
      citationCandidates.map((citation) => [
        `${citation.source}\u0000${citation.fileName || ''}\u0000${citation.workspaceId || ''}`,
        citation,
      ]),
    );
    if (uniqueCitations.size !== 1) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation not found');
    }
    const persistedCitation = [...uniqueCitations.values()][0];

    const conversation = await this.conversationService.getConversationDocument(conversationId);
    const governed = conversation.runtimeMode === 'governed';
    if (governed && (!userId || !this.governedRuntime)) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation not found');
    }
    const allowedWorkspaceIds = new Set(governed
      ? (await this.governedRuntime!.resolveRuntime(userId!, conversation)).workspaceIds
      : await this.conversationService.filterAccessibleWorkspaceIds(userId,
        (conversation.workspaces || []).map((id) => id.toString())));
    if (!governed && conversation.systemWorkspaceId) {
      allowedWorkspaceIds.add(conversation.systemWorkspaceId.toString());
    }
    if (persistedCitation.workspaceId && !allowedWorkspaceIds.has(persistedCitation.workspaceId)) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation document not found');
    }
    if (persistedCitation.workspaceId) {
      allowedWorkspaceIds.clear();
      allowedWorkspaceIds.add(persistedCitation.workspaceId);
    }

    const fileName = persistedCitation.fileName || persistedCitation.source.split('/').pop();
    if (!fileName || allowedWorkspaceIds.size === 0) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation document not found');
    }
    const result = await this.workspaceDocumentService.findByMultipleWorkspaces(
      [...allowedWorkspaceIds],
      { search: fileName, page: 1, limit: 100, searchFilename: true },
    );
    const matches = result.documents.filter((document) =>
      !document.isFolder && document.path &&
      (document.originalName === fileName || document.filename === fileName),
    );
    if (matches.length !== 1 || result.pagination.total > result.documents.length) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation document not found');
    }
    if (!this.documentService.isAvailable()) {
      throw new ServiceUnavailableException(undefined, 'Document service is currently unavailable');
    }

    const document = matches[0];
    const url = await this.documentService.generateSasUrl(document.path!, {
      expiryMinutes: 10,
      checkExists: true,
    });
    if (governed) {
      const current = await this.conversationService.getConversationDocument(conversationId);
      const runtime = await this.governedRuntime!.resolveRuntime(userId!, current);
      if (current.governanceContext?.revisionId !== conversation.governanceContext?.revisionId
        || [...allowedWorkspaceIds].some((id) => !runtime.workspaceIds.includes(id))) {
        throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation not found');
      }
    }
    return { url, fileName: document.originalName, mimeType: document.mimeType };
  }

  private getCitationIdentity(data: Record<string, unknown>): {
    source: string;
    fileName?: string;
    workspaceId?: string;
    reference?: string;
  } {
    const textSource = data.text_source as Record<string, unknown> | undefined;
    const imageSource = data.image_source as Record<string, unknown> | undefined;
    const sourceData = textSource || imageSource || data;
    const sourceType = data.sourceType ?? data.source_type;
    const isImageSource = Boolean(imageSource) || sourceType === 'image';
    const value = (key: string, snakeKey: string): string | undefined => {
      const candidate = sourceData[key] ?? sourceData[snakeKey];
      return typeof candidate === 'string' && candidate ? candidate : undefined;
    };
    return {
      source: (isImageSource ? value('path', 'path') : value('source', 'source')) || '',
      fileName: value('fileName', 'file_name') || (isImageSource ? value('source', 'source') : undefined),
      workspaceId: value('workspaceId', 'workspace_id'),
      reference: this.normalizeReference(value('reference', 'reference')),
    };
  }

  private normalizeReference(reference?: string): string | undefined {
    return reference?.trim().replace(/^\[|\]$/g, '').trim() || undefined;
  }
}
