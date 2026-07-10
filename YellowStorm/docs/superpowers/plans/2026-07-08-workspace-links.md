# Workspace Links (Website Indexing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add website links to a workspace; the backend converts each link to a PDF via a third-party API, stores it, and indexes it like any other document, shown with a web icon.

**Architecture:** A link is a normal `WorkspaceDoc` with a new `type='url'` field, `mimeType='application/pdf'`, and a `sourceUrl`. Adding a link creates the doc in a `processing` state and returns immediately; a fire-and-forget backend step converts the URL to PDF, uploads the PDF to Ceph, marks the doc `completed`, and calls the existing `indexingService.queueDocument`. The existing indexing pipeline and SSE status notifications then apply unchanged. The visible file list is served by the classifier module (`listFiles`), which already returns docs of any status.

**Tech Stack:** NestJS + Mongoose + axios (backend, Jest tests); React + TypeScript + Vite + Zustand + react-hook-form/zod + lucide-react (frontend, Vitest + @testing-library/react).

## Global Constraints

- Backend tests: `cd back && npm test` (Jest). Frontend tests: `cd front && npm test` (Vitest, `vitest run`).
- Do not use `@nestjs/axios`/`HttpService`; use plain `axios` (project convention).
- External API config lives in `back/src/config/indexing.config.ts` via `registerAs('indexing', …)`.
- UI copy is French (matches existing UI).
- New enum value: `DocumentType { DOC = 'doc', URL = 'url' }`; every existing/normal document is `'doc'` (default), so the field is backward compatible.
- A URL document's lifecycle: `status` PROCESSING → COMPLETED (or FAILED); `indexingStatus` NONE during conversion, then driven by the existing indexing pipeline. The frontend "Conversion…" indicator is shown when `type==='url' && indexingStatus==='none'`.
- Commit after each task with the message shown in its final step.

---

### Task 1: Schema + response mapping — add `type` and `sourceUrl`

**Files:**
- Modify: `back/src/modules/workspace/schemas/workspace-document.schema.ts`
- Modify: `back/src/modules/workspace/interfaces/workspace-document.interface.ts`
- Modify: `back/src/modules/workspace/workspace-document.service.ts` (`mapToResponse`, ~line 2039)
- Test: `back/src/modules/workspace/workspace-document.service.spec.ts` (existing)

**Interfaces:**
- Produces: `enum DocumentType { DOC = 'doc', URL = 'url' }` exported from the schema file; `WorkspaceDoc.type: DocumentType`, `WorkspaceDoc.sourceUrl?: string`; `DocumentResponse.type: DocumentType`, `DocumentResponse.sourceUrl?: string`.

- [ ] **Step 1: Add the enum and fields to the schema**

In `workspace-document.schema.ts`, add the enum next to `IndexingStatus` (after line 20):

```ts
export enum DocumentType {
  DOC = 'doc',
  URL = 'url',
}
```

Add the two props inside the `WorkspaceDoc` class (after the `folderName` prop, before the `createdAt!` line ~108):

```ts
  @Prop({
    type: String,
    enum: DocumentType,
    default: DocumentType.DOC,
    index: true,
  })
  type!: DocumentType;

  @Prop({ maxlength: 2000 })
  sourceUrl?: string;
```

- [ ] **Step 2: Add fields to the response interface**

In `interfaces/workspace-document.interface.ts`, change the import on line 1 and add fields to `DocumentResponse` (after `isFolder: boolean;` ~line 52):

```ts
import { DocumentStatus, DocumentType, IndexingStatus } from '../schemas/workspace-document.schema';
```
```ts
  type: DocumentType;
  sourceUrl?: string;
```

- [ ] **Step 3: Populate them in `mapToResponse`**

In `workspace-document.service.ts`, import `DocumentType` where `DocumentStatus`/`IndexingStatus` are imported from the schema, then in `mapToResponse` (~line 2063, after `isFolder: document.isFolder || false,`) add:

```ts
      type: (document.type as DocumentType) || DocumentType.DOC,
      sourceUrl: document.sourceUrl,
```

- [ ] **Step 4: Write a test for the mapping default**

Add to `workspace-document.service.spec.ts` a test asserting that a mapped legacy document (no `type`) yields `type: 'doc'`. Find the existing describe block and add:

```ts
  it('defaults mapToResponse.type to "doc" for legacy documents', () => {
    // mapToResponse is private; call via any-cast on the service instance.
    const doc: any = {
      _id: { toString: () => 'id1' },
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      size: 1,
      workspaceId: { toString: () => 'ws1' },
      createdBy: { toString: () => 'u1' },
      status: 'completed',
      indexingStatus: 'ready',
      isFolder: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const res = (service as any).mapToResponse(doc);
    expect(res.type).toBe('doc');
    expect(res.sourceUrl).toBeUndefined();
  });
```

- [ ] **Step 5: Run the test**

Run: `cd back && npx jest workspace-document.service.spec.ts -t "defaults mapToResponse.type"`
Expected: PASS. (If the spec's service setup differs, mirror how existing tests construct `service`.)

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/workspace/schemas/workspace-document.schema.ts back/src/modules/workspace/interfaces/workspace-document.interface.ts back/src/modules/workspace/workspace-document.service.ts back/src/modules/workspace/workspace-document.service.spec.ts
git commit -m "feat(workspace): add type/sourceUrl fields to workspace documents"
```

---

### Task 2: Config + `UrlToPdfClientService`

**Files:**
- Modify: `back/src/config/indexing.config.ts`
- Create: `back/src/modules/workspace/services/url-to-pdf-client.service.ts`
- Create: `back/src/modules/workspace/services/url-to-pdf-client.service.spec.ts`

**Interfaces:**
- Produces: `class UrlToPdfClientService` with `async convert(url: string, filename: string): Promise<Buffer>`. On non-2xx/network error, throws `Error` with a descriptive message.

- [ ] **Step 1: Add config keys**

In `indexing.config.ts`, add inside the returned object (after `enabled:` line 15):

```ts
  urlToPdfApiUrl: process.env.URL_TO_PDF_API_URL || 'http://localhost:5000',
  urlToPdfApiKey: process.env.URL_TO_PDF_API_KEY || '',
```

- [ ] **Step 2: Write the failing client test**

Create `services/url-to-pdf-client.service.spec.ts`:

```ts
import { UrlToPdfClientService } from './url-to-pdf-client.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeService() {
  const config = { get: (k: string, d?: unknown) => (k === 'indexing.urlToPdfApiUrl' ? 'http://pdf.test' : k === 'indexing.urlToPdfApiKey' ? 'secret' : d) };
  const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return new UrlToPdfClientService(config as any, logger as any);
}

describe('UrlToPdfClientService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts convert-url-pdf with hardcoded flags and returns a Buffer', async () => {
    const post = jest.fn().mockResolvedValue({ data: Buffer.from('%PDF-1.4 fake') });
    mockedAxios.create.mockReturnValue({ post, interceptors: { request: { use: jest.fn() } } } as any);
    const svc = makeService();
    const out = await svc.convert('https://example.com', 'example-com.pdf');
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(post).toHaveBeenCalledWith('/convert-url-pdf', {
      url: 'https://example.com',
      filename: 'example-com.pdf',
      print_background: true,
      prefer_css_page_size: true,
    }, { responseType: 'arraybuffer' });
  });

  it('throws a descriptive error on failure', async () => {
    const post = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { isAxiosError: true, response: { status: 502, data: 'bad' } }));
    mockedAxios.create.mockReturnValue({ post, interceptors: { request: { use: jest.fn() } } } as any);
    mockedAxios.isAxiosError.mockReturnValue(true as any);
    const svc = makeService();
    await expect(svc.convert('https://x.com', 'x.pdf')).rejects.toThrow(/URL-to-PDF API error: 502/);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd back && npx jest url-to-pdf-client.service.spec.ts`
Expected: FAIL with "Cannot find module './url-to-pdf-client.service'".

- [ ] **Step 4: Implement the client**

Create `services/url-to-pdf-client.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { LoggerService } from '../../logger';

@Injectable()
export class UrlToPdfClientService {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('UrlToPdfClientService');
    this.apiUrl = this.configService.get<string>('indexing.urlToPdfApiUrl', 'http://localhost:5000');
    this.apiKey = this.configService.get<string>('indexing.urlToPdfApiKey', '');

    this.httpClient = axios.create({
      baseURL: this.apiUrl,
      headers: { 'Content-Type': 'application/json' },
      timeout: 120_000,
    });

    this.httpClient.interceptors.request.use((config) => {
      if (this.apiKey) {
        config.headers['x-api-key'] = this.apiKey;
      }
      return config;
    });
  }

  async convert(url: string, filename: string): Promise<Buffer> {
    try {
      const response = await this.httpClient.post(
        '/convert-url-pdf',
        {
          url,
          filename,
          print_background: true,
          prefer_css_page_size: true,
        },
        { responseType: 'arraybuffer' },
      );
      return Buffer.from(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const message = `URL-to-PDF API error: ${status} - ${JSON.stringify(data) || error.message}`;
        this.logger.error(message, { url, status });
        throw new Error(message);
      }
      throw error;
    }
  }
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd back && npx jest url-to-pdf-client.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add back/src/config/indexing.config.ts back/src/modules/workspace/services/url-to-pdf-client.service.ts back/src/modules/workspace/services/url-to-pdf-client.service.spec.ts
git commit -m "feat(workspace): add URL-to-PDF client service and config"
```

---

### Task 3: Service — `addLink`, `convertAndStore`, `deriveFilenameFromUrl`, `checkUrlReachable`

**Files:**
- Create: `back/src/modules/workspace/dto/add-link.dto.ts`
- Modify: `back/src/modules/workspace/dto/index.ts` (barrel — add export)
- Modify: `back/src/modules/workspace/workspace-document.service.ts`
- Modify: `back/src/modules/workspace/workspace-document.service.spec.ts`

**Interfaces:**
- Consumes: `UrlToPdfClientService.convert` (Task 2); `DocumentType`, `DocumentStatus`, `IndexingStatus` (Task 1); existing `documentService.upload`, `workspaceService.getStorageContext/checkStorageQuota/updateStorageUsage`, `indexingService.queueDocument`, `indexingService.sendIndexingStatusNotification`, `this.resolveUniqueOriginalName`, `this.sanitizeFilename`.
- Produces: `AddLinkDto { url: string }`; `WorkspaceDocumentService.addLink(workspaceId: string, userId: string, url: string): Promise<DocumentResponse>`; `WorkspaceDocumentService.checkUrlReachable(url: string): Promise<{ reachable: boolean; status?: number; error?: string }>`.

- [ ] **Step 1: Create the DTO**

Create `dto/add-link.dto.ts`:

```ts
import { IsUrl } from 'class-validator';

export class AddLinkDto {
  @IsUrl({ require_protocol: true }, { message: 'url must be a valid http(s) URL' })
  url!: string;
}
```

Add to `dto/index.ts`:

```ts
export * from './add-link.dto';
```

- [ ] **Step 2: Inject `UrlToPdfClientService` into the service constructor**

In `workspace-document.service.ts`, import it and add a constructor param:

```ts
import { UrlToPdfClientService } from './services/url-to-pdf-client.service';
```
Add to the constructor parameter list (alongside the existing injected services):
```ts
    private readonly urlToPdfClient: UrlToPdfClientService,
```
Also ensure `DocumentType` is imported from the schema and `AddLinkDto` is available (import from `./dto/add-link.dto` or the barrel).

- [ ] **Step 3: Write failing tests for `deriveFilenameFromUrl` and `addLink`**

Add to `workspace-document.service.spec.ts`:

```ts
  it('derives a sanitized .pdf filename from a URL', () => {
    const d = (service as any).deriveFilenameFromUrl.bind(service);
    expect(d('https://www.example.com/docs/guide/')).toBe('example.com-docs-guide.pdf');
    expect(d('https://example.com')).toBe('example.com.pdf');
    expect(d('not a url')).toBe('website.pdf');
  });
```

For `addLink`, add a test that it creates a PROCESSING url doc and returns immediately (mock the collaborators). Mirror the existing spec's mocking style for `documentModel.create`, `workspaceService`, `indexingService`, `urlToPdfClient`. Minimal shape:

```ts
  it('addLink creates a processing url document and returns it', async () => {
    (service as any).resolveUniqueOriginalName = jest.fn().mockResolvedValue('example.com.pdf');
    const created = {
      _id: { toString: () => 'doc1' },
      originalName: 'example.com.pdf',
      mimeType: 'application/pdf',
      size: 0,
      type: 'url',
      sourceUrl: 'https://example.com',
      workspaceId: { toString: () => 'ws1' },
      createdBy: { toString: () => 'u1' },
      status: 'processing',
      indexingStatus: 'none',
      isFolder: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (documentModel.create as jest.Mock).mockResolvedValue(created);
    // Prevent the fire-and-forget conversion from doing real work in this test.
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);

    const res = await service.addLink('ws1', 'u1', 'https://example.com');
    expect(res.type).toBe('url');
    expect(res.status).toBe('processing');
    expect(res.sourceUrl).toBe('https://example.com');
    expect((service as any).convertAndStore).toHaveBeenCalled();
  });
```

(Adjust `documentModel`/collaborator references to match how the existing spec exposes them.)

- [ ] **Step 4: Run to confirm failure**

Run: `cd back && npx jest workspace-document.service.spec.ts -t "url document"`
Expected: FAIL (`addLink`/`deriveFilenameFromUrl` not a function).

- [ ] **Step 5: Implement the methods**

Add these methods to `WorkspaceDocumentService` (near `ingestFromUrl`, ~line 653):

```ts
  /**
   * Add a website link as a workspace document. Creates the doc immediately in a
   * PROCESSING state and returns it; conversion to PDF + indexing runs in the
   * background (fire-and-forget). The stored artifact is a PDF.
   */
  async addLink(
    workspaceId: string,
    userId: string,
    url: string,
  ): Promise<DocumentResponse> {
    const filename = this.deriveFilenameFromUrl(url);
    const effectiveName = await this.resolveUniqueOriginalName(workspaceId, filename);
    const documentId = new Types.ObjectId();

    const document = await this.documentModel.create({
      _id: documentId,
      originalName: effectiveName,
      mimeType: 'application/pdf',
      size: 0,
      type: DocumentType.URL,
      sourceUrl: url,
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.PROCESSING,
      indexingStatus: IndexingStatus.NONE,
    });

    this.convertAndStore(document._id.toString(), workspaceId, url, effectiveName).catch(
      (err) => {
        this.logger.error('convertAndStore failed', {
          documentId: document._id.toString(),
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      },
    );

    this.logger.debug('Link document created', { documentId: document._id, workspaceId, url });
    return this.mapToResponse(document);
  }

  /**
   * Background step: convert the website to PDF, store it, mark the doc COMPLETED,
   * and queue indexing. On failure, mark the doc FAILED and notify the owner.
   */
  private async convertAndStore(
    documentId: string,
    workspaceId: string,
    url: string,
    filename: string,
  ): Promise<void> {
    try {
      const pdf = await this.urlToPdfClient.convert(url, filename);
      const size = pdf.length;

      const quota = await this.workspaceService.checkStorageQuota(workspaceId, size);
      if (!quota.allowed) {
        throw new Error('Insufficient storage for converted PDF');
      }

      const { ownerUserId, storagePrefix } = await this.workspaceService.getStorageContext(
        workspaceId,
      );
      const sanitizedName = this.sanitizeFilename(filename);
      const uploaded = await this.documentService.upload(pdf, filename, 'application/pdf', {
        folder: `${ownerUserId}/${storagePrefix}`,
        generateUniqueName: false,
        customFileName: sanitizedName,
      });

      await this.documentModel.findByIdAndUpdate(documentId, {
        $set: {
          filename: uploaded.storedName,
          path: uploaded.blobPath,
          url: uploaded.url,
          contentHash: uploaded.contentHash,
          size,
          status: DocumentStatus.COMPLETED,
          uploadedAt: new Date(),
        },
      });

      await this.workspaceService.updateStorageUsage(workspaceId, size, 1);
      await this.indexingService.queueDocument(documentId);

      this.logger.debug('Link converted and stored', { documentId, workspaceId, size });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Link conversion failed';
      const failed = await this.documentModel.findByIdAndUpdate(
        documentId,
        {
          $set: {
            status: DocumentStatus.FAILED,
            indexingStatus: IndexingStatus.FAILED,
            errorMessage: message,
            indexingError: message,
          },
        },
        { new: true },
      );
      if (failed) {
        await this.indexingService.sendIndexingStatusNotification(failed).catch(() => undefined);
      }
      this.logger.error('Link conversion failed', { documentId, workspaceId, error: message });
    }
  }

  /**
   * Derive a filesystem-safe `.pdf` name from a URL (hostname + path).
   */
  private deriveFilenameFromUrl(url: string): string {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      const pathPart = u.pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
      const base = pathPart ? `${host}-${pathPart}` : host;
      const sanitized = base
        .replace(/[^a-zA-Z0-9-_.]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 200);
      return `${sanitized || 'website'}.pdf`;
    } catch {
      return 'website.pdf';
    }
  }

  /**
   * Check that a URL is reachable (HEAD, falling back to GET). Used by the
   * link modal before the user commits to adding the link.
   */
  async checkUrlReachable(
    url: string,
  ): Promise<{ reachable: boolean; status?: number; error?: string }> {
    const opts = { timeout: 5000, maxRedirects: 5, validateStatus: () => true } as const;
    try {
      const head = await axios.head(url, opts);
      if (head.status >= 200 && head.status < 400) {
        return { reachable: true, status: head.status };
      }
      const get = await axios.get(url, { ...opts, responseType: 'stream' });
      const ok = get.status >= 200 && get.status < 400;
      return { reachable: ok, status: get.status, error: ok ? undefined : `HTTP ${get.status}` };
    } catch (error) {
      const err = error as { message?: string };
      return { reachable: false, error: err?.message ?? 'unreachable' };
    }
  }
```

Note: `axios`, `Types`, `DocumentStatus`, `IndexingStatus`, `DocumentType` must all be imported at the top of the file (axios and Types already are; add `DocumentType` to the schema import).

- [ ] **Step 6: Run tests to confirm pass**

Run: `cd back && npx jest workspace-document.service.spec.ts`
Expected: PASS (including the two new tests).

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/workspace/dto/add-link.dto.ts back/src/modules/workspace/dto/index.ts back/src/modules/workspace/workspace-document.service.ts back/src/modules/workspace/workspace-document.service.spec.ts
git commit -m "feat(workspace): add link ingestion (convert URL to PDF) service methods"
```

---

### Task 4: Controller endpoints + module wiring

**Files:**
- Modify: `back/src/modules/workspace/workspace-document.controller.ts`
- Modify: `back/src/modules/workspace/workspace.module.ts`

**Interfaces:**
- Consumes: `WorkspaceDocumentService.addLink`, `WorkspaceDocumentService.checkUrlReachable` (Task 3); `UrlToPdfClientService` (Task 2); `AddLinkDto` (Task 3).
- Produces: `POST /workspaces/:workspaceId/documents/link` (body `{ url }`) → `DocumentResponse`; `POST /workspaces/:workspaceId/documents/validate-url` (body `{ url }`) → `{ reachable, status?, error? }`.

- [ ] **Step 1: Register `UrlToPdfClientService` as a provider**

In `workspace.module.ts`, import it and add to the `providers` array:

```ts
import { UrlToPdfClientService } from './services/url-to-pdf-client.service';
```
```ts
    UrlToPdfClientService,
```

(`ConfigModule` is already available app-wide; `indexingConfig` is registered in `IndexingModule`. `UrlToPdfClientService` only reads `indexing.*` config via the global `ConfigService`, so no extra `forFeature` is needed. If config values resolve empty at runtime, add `ConfigModule.forFeature(indexingConfig)` to this module's imports.)

- [ ] **Step 2: Add the endpoints to the controller**

In `workspace-document.controller.ts`, add the DTO import:

```ts
import { AddLinkDto } from './dto/add-link.dto';
```

Add these handlers to the class (after `uploadSmallFile`, ~line 96):

```ts
  @Post('validate-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check whether a website URL is reachable' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  async validateUrl(
    @Param('workspaceId') _workspaceId: string,
    @Body() body: AddLinkDto,
  ) {
    return this.workspaceDocumentService.checkUrlReachable(body.url);
  }

  @Post('link')
  @UseGuards(WritePermissionGuard)
  @ApiOperation({ summary: 'Add a website link (converted to PDF and indexed)' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiResponse({ status: 201, description: 'Link accepted; conversion in progress' })
  async addLink(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @Body() body: AddLinkDto,
  ) {
    return this.workspaceDocumentService.addLink(
      workspaceId,
      user._id.toString(),
      body.url,
    );
  }
```

- [ ] **Step 3: Verify the backend compiles**

Run: `cd back && npx tsc --noEmit -p tsconfig.json`
Expected: no errors (or only pre-existing unrelated ones).

- [ ] **Step 4: Verify the app module resolves (smoke test the DI graph)**

Run: `cd back && npm test`
Expected: existing suites + Tasks 1-3 tests PASS; no DI resolution errors.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/workspace/workspace-document.controller.ts back/src/modules/workspace/workspace.module.ts
git commit -m "feat(workspace): add link and validate-url endpoints"
```

---

### Task 5: Classifier file response — surface `type` and `sourceUrl`

The visible workspace file list is served by `ClassifierFileService.listFiles`. It already returns non-folder docs of any status, so a converting URL doc appears automatically; we only need to surface `type`/`sourceUrl`.

**Files:**
- Modify: `back/src/modules/classifier/interfaces/classifier.interface.ts`
- Modify: `back/src/modules/classifier/services/classifier-file.service.ts` (`toResponse`, ~line 252)

**Interfaces:**
- Produces: `IClassifierFileResponse.type: 'doc' | 'url'`, `IClassifierFileResponse.sourceUrl?: string`.

- [ ] **Step 1: Add fields to the interface**

In `classifier.interface.ts`, inside `IClassifierFileResponse` (after `lastIndexedAt?: string;` line 28):

```ts
  type: 'doc' | 'url';
  sourceUrl?: string;
```

- [ ] **Step 2: Populate them in `toResponse`**

In `classifier-file.service.ts` `toResponse` (in the returned object, after the `lastIndexedAt` field ~line 274):

```ts
      type: (doc.type as 'doc' | 'url') ?? 'doc',
      sourceUrl: (doc.sourceUrl as string | undefined) ?? undefined,
```

- [ ] **Step 3: Verify compile**

Run: `cd back && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/classifier/interfaces/classifier.interface.ts back/src/modules/classifier/services/classifier-file.service.ts
git commit -m "feat(classifier): surface document type/sourceUrl in file listing"
```

---

### Task 6: Frontend types, API config, and API functions

**Files:**
- Modify: `front/src/modules/workspace/types.ts` (`WorkspaceFile` ~line 127, `WorkspaceDocument` ~line 70)
- Modify: `front/src/lib/api/config.ts` (`workspaceDocuments` object ~line 114)
- Modify: `front/src/modules/workspace/api.ts`
- Test: `front/src/modules/workspace/api.link.test.ts` (new)

**Interfaces:**
- Produces: `WorkspaceFile.type?: 'doc' | 'url'`, `WorkspaceFile.sourceUrl?: string`; `API_ENDPOINTS.workspaceDocuments.link(id)`, `.validateUrl(id)`; `validateUrl(workspaceId, url): Promise<{ reachable: boolean; status?: number; error?: string }>`; `addLink(workspaceId, url): Promise<WorkspaceDocument>`.

- [ ] **Step 1: Extend the types**

In `types.ts`, add to `WorkspaceFile` (after `lastIndexedAt?: string;` ~line 141):

```ts
  /** Discriminates uploaded documents ('doc') from website links ('url'). */
  type?: 'doc' | 'url';
  /** Original website URL when type === 'url'. */
  sourceUrl?: string;
```

Add to `WorkspaceDocument` (after `folderName?: string;` ~line 92):

```ts
  type?: 'doc' | 'url';
  sourceUrl?: string;
```

- [ ] **Step 2: Add endpoints**

In `config.ts`, inside the `workspaceDocuments` object (near the `upload` entry ~line 114-137), add:

```ts
    link: (workspaceId: string) => `/workspaces/${workspaceId}/documents/link`,
    validateUrl: (workspaceId: string) => `/workspaces/${workspaceId}/documents/validate-url`,
```

- [ ] **Step 3: Write the failing api test**

Create `front/src/modules/workspace/api.link.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/client', () => {
  const post = vi.fn();
  return { default: { post }, __post: post };
});

import apiClient from '@/lib/api/client';
import { validateUrl, addLink } from './api';

const post = (apiClient as unknown as { post: ReturnType<typeof vi.fn> }).post;

describe('workspace link api', () => {
  beforeEach(() => post.mockReset());

  it('validateUrl posts the url and returns the envelope data', async () => {
    post.mockResolvedValue({ data: { data: { reachable: true, status: 200 } } });
    const res = await validateUrl('ws1', 'https://example.com');
    expect(post).toHaveBeenCalledWith('/workspaces/ws1/documents/validate-url', { url: 'https://example.com' });
    expect(res.reachable).toBe(true);
  });

  it('addLink posts the url and returns the created document', async () => {
    post.mockResolvedValue({ data: { data: { id: 'd1', type: 'url', status: 'processing' } } });
    const res = await addLink('ws1', 'https://example.com');
    expect(post).toHaveBeenCalledWith('/workspaces/ws1/documents/link', { url: 'https://example.com' });
    expect(res.type).toBe('url');
  });
});
```

- [ ] **Step 4: Run it to confirm failure**

Run: `cd front && npx vitest run src/modules/workspace/api.link.test.ts`
Expected: FAIL (`validateUrl`/`addLink` not exported).

- [ ] **Step 5: Implement the api functions**

In `api.ts`, add (mirroring the existing `apiClient.post(...).data.data` pattern; ensure `WorkspaceDocument` is imported from `./types`):

```ts
export async function validateUrl(
  workspaceId: string,
  url: string,
): Promise<{ reachable: boolean; status?: number; error?: string }> {
  const response = await apiClient.post<ApiResponse<{ reachable: boolean; status?: number; error?: string }>>(
    API_ENDPOINTS.workspaceDocuments.validateUrl(workspaceId),
    { url },
  );
  return response.data.data;
}

export async function addLink(
  workspaceId: string,
  url: string,
): Promise<WorkspaceDocument> {
  const response = await apiClient.post<ApiResponse<WorkspaceDocument>>(
    API_ENDPOINTS.workspaceDocuments.link(workspaceId),
    { url },
  );
  return response.data.data;
}
```

- [ ] **Step 6: Run the test to confirm pass**

Run: `cd front && npx vitest run src/modules/workspace/api.link.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add front/src/modules/workspace/types.ts front/src/lib/api/config.ts front/src/modules/workspace/api.ts front/src/modules/workspace/api.link.test.ts
git commit -m "feat(workspace-ui): add link/validate-url api client and types"
```

---

### Task 7: URL-detection util + store `addPageLink` action

**Files:**
- Modify: `front/src/modules/workspace/utils.ts`
- Create: `front/src/modules/workspace/utils.link.test.ts`
- Modify: `front/src/modules/workspace/store.ts`

**Interfaces:**
- Consumes: `addLink` (Task 6), `refreshPageData` (existing store action).
- Produces: `extractUrlFromText(text: string): string | null`; store action `addPageLink(workspaceId: string, url: string): Promise<void>` added to the store interface and implementation.

- [ ] **Step 1: Write the failing util test**

Create `utils.link.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractUrlFromText } from './utils';

describe('extractUrlFromText', () => {
  it('accepts http/https URLs', () => {
    expect(extractUrlFromText('https://example.com/x')).toBe('https://example.com/x');
    expect(extractUrlFromText('  http://foo.bar  ')).toBe('http://foo.bar');
  });
  it('finds a URL inside surrounding text', () => {
    expect(extractUrlFromText('see https://example.com here')).toBe('https://example.com');
  });
  it('rejects non-URLs', () => {
    expect(extractUrlFromText('just some words')).toBeNull();
    expect(extractUrlFromText('ftp://nope.com')).toBeNull();
    expect(extractUrlFromText('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd front && npx vitest run src/modules/workspace/utils.link.test.ts`
Expected: FAIL (`extractUrlFromText` not exported).

- [ ] **Step 3: Implement the util**

Add to `utils.ts`:

```ts
/**
 * Extract the first http(s) URL from arbitrary dropped/typed text.
 * Returns the URL string, or null if none found.
 */
export function extractUrlFromText(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  const candidate = match[0];
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return candidate;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `cd front && npx vitest run src/modules/workspace/utils.link.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the store action**

In `store.ts`:
- Import `addLink` from `./api` (add to the existing `./api` import).
- Add to the store's state/actions interface (near `refreshPageData` ~line 288):

```ts
  addPageLink: (workspaceId: string, url: string) => Promise<void>;
```

- Implement it in the store object (near `uploadPageFiles` ~line 1888):

```ts
      addPageLink: async (workspaceId, url) => {
        await addLink(workspaceId, url);
        // The link doc is created server-side in a "processing" state; reload so
        // it appears immediately. Live status flows via the existing indexing SSE.
        await get().refreshPageData();
      },
```

- [ ] **Step 6: Verify build**

Run: `cd front && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add front/src/modules/workspace/utils.ts front/src/modules/workspace/utils.link.test.ts front/src/modules/workspace/store.ts
git commit -m "feat(workspace-ui): add URL detection util and addPageLink store action"
```

---

### Task 8: `AddLinkDialog` component

**Files:**
- Create: `front/src/modules/workspace/components/AddLinkDialog.tsx`
- Create: `front/src/modules/workspace/components/AddLinkDialog.test.tsx`

**Interfaces:**
- Consumes: `validateUrl` (Task 6), `addPageLink` store action (Task 7), `extractUrlFromText` (Task 7).
- Produces: `AddLinkDialog({ open, onOpenChange, workspaceId, initialUrl? })` React component.

- [ ] **Step 1: Write the failing component test**

Create `AddLinkDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const validateUrl = vi.fn();
const addPageLink = vi.fn();

vi.mock('../api', () => ({ validateUrl: (...a: unknown[]) => validateUrl(...a) }));
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) => sel({ addPageLink }),
}));

import { AddLinkDialog } from './AddLinkDialog';

describe('AddLinkDialog', () => {
  beforeEach(() => { validateUrl.mockReset(); addPageLink.mockReset(); });

  it('blocks submit on invalid URL format', async () => {
    render(<AddLinkDialog open onOpenChange={() => {}} workspaceId="ws1" />);
    fireEvent.change(screen.getByLabelText(/lien/i), { target: { value: 'not a url' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    expect(validateUrl).not.toHaveBeenCalled();
    expect(await screen.findByText(/URL valide/i)).toBeInTheDocument();
  });

  it('shows an error when the site is unreachable', async () => {
    validateUrl.mockResolvedValue({ reachable: false, error: 'timeout' });
    render(<AddLinkDialog open onOpenChange={() => {}} workspaceId="ws1" />);
    fireEvent.change(screen.getByLabelText(/lien/i), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    await waitFor(() => expect(validateUrl).toHaveBeenCalledWith('ws1', 'https://example.com'));
    expect(await screen.findByText(/injoignable/i)).toBeInTheDocument();
    expect(addPageLink).not.toHaveBeenCalled();
  });

  it('adds the link when reachable', async () => {
    validateUrl.mockResolvedValue({ reachable: true, status: 200 });
    addPageLink.mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<AddLinkDialog open onOpenChange={onOpenChange} workspaceId="ws1" />);
    fireEvent.change(screen.getByLabelText(/lien/i), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    await waitFor(() => expect(addPageLink).toHaveBeenCalledWith('ws1', 'https://example.com'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the dialog**

Create `AddLinkDialog.tsx` (models `CreateFolderDialog.tsx`; uses inline validation):

```tsx
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { validateUrl } from '../api';
import { useWorkspaceStore } from '../store';

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function AddLinkDialog({
  open,
  onOpenChange,
  workspaceId,
  initialUrl = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  initialUrl?: string;
}) {
  const addPageLink = useWorkspaceStore((s) => s.addPageLink);
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open, initialUrl]);

  const handleSubmit = async () => {
    setError(null);
    if (!isValidUrl(url)) {
      setError('Veuillez saisir une URL valide (http:// ou https://).');
      return;
    }
    const clean = url.trim();
    setIsSubmitting(true);
    try {
      const result = await validateUrl(workspaceId, clean);
      if (!result.reachable) {
        setError('Ce site est injoignable. Vérifiez le lien et réessayez.');
        setIsSubmitting(false);
        return;
      }
      await addPageLink(workspaceId, clean);
      toast.success('Lien ajouté · conversion en cours');
      onOpenChange(false);
    } catch {
      setError('Une erreur est survenue. Réessayez.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un lien</DialogTitle>
          <DialogDescription>
            Indexez le contenu d'un site web. La page sera convertie en PDF puis indexée.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          <Label htmlFor='workspace-link-url'>Lien du site web</Label>
          <Input
            id='workspace-link-url'
            placeholder='https://exemple.com/page'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
            autoFocus
          />
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} className='gap-1.5'>
            {isSubmitting && <Loader2 className='h-4 w-4 animate-spin' />}
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx`
Expected: PASS (3 tests). If the shadcn `Dialog` doesn't render children in jsdom without a portal container, the tests still target `open` state which mounts content; if a portal issue arises, assert via `screen.findByRole('dialog')` first.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/workspace/components/AddLinkDialog.tsx front/src/modules/workspace/components/AddLinkDialog.test.tsx
git commit -m "feat(workspace-ui): add link dialog with format + reachability validation"
```

---

### Task 9: Upload dropdown + drag-text detection in `WorkspaceUploadDropZone`

**Files:**
- Modify: `front/src/modules/workspace/components/WorkspaceUploadDropZone.tsx`

**Interfaces:**
- Consumes: `AddLinkDialog` (Task 8), `extractUrlFromText` (Task 7), existing `useWorkspaceStore`, `uploadPageFiles`, `selectedWorkspaceId`.

- [ ] **Step 1: Rework the component**

Replace `WorkspaceUploadDropZone.tsx` with a version that (a) offers a dropdown with "Importer un document" and "Ajouter un lien", (b) keeps file drag-drop, and (c) opens the link dialog prefilled when a URL is dragged. Full file:

```tsx
import { useCallback, useRef, useState } from 'react';
import { Upload, FileUp, Link2, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { useWorkspaceStore, useCanWriteWorkspace } from '../store';
import { MAX_FILE_SIZE, MAX_FILES_PER_UPLOAD, formatFileSize, extractUrlFromText } from '../utils';
import { useAllowedUploadExtensions } from '../hooks/useAllowedUploadExtensions';
import { readAutoIndexationValue } from '../hooks/useAutoIndexation';
import { readDeepSearchIndexationValue } from '../hooks/useDeepSearchIndexation';
import { AddLinkDialog } from './AddLinkDialog';

export function WorkspaceUploadDropZone() {
  const canWrite = useCanWriteWorkspace();
  const uploadPageFiles = useWorkspaceStore((s) => s.uploadPageFiles);
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const { accept } = useAllowedUploadExtensions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInitialUrl, setLinkInitialUrl] = useState('');

  const pushFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    void uploadPageFiles(Array.from(list), {
      autoIndex: readAutoIndexationValue(),
      deepSearch: readDeepSearchIndexationValue(),
    });
  };

  const openLink = (initialUrl: string) => {
    setLinkInitialUrl(initialUrl);
    setLinkOpen(true);
  };

  const dragHasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const dragHasText = (e: React.DragEvent) =>
    e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain');

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e) && !dragHasText(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e) && !dragHasText(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const hasFiles = dragHasFiles(e);
      const hasText = dragHasText(e);
      if (!hasFiles && !hasText) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragOver(false);
      if (hasFiles) {
        pushFiles(e.dataTransfer.files);
        return;
      }
      const raw = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const url = extractUrlFromText(raw);
      if (url) openLink(url);
    },
    [pushFiles],
  );

  if (!canWrite) return null;

  return (
    <>
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'group flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
          'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50',
          isDragOver && 'border-primary bg-primary/10',
        )}
      >
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform',
            isDragOver && 'scale-110',
          )}
        >
          <Upload className='h-5 w-5' />
        </div>
        <div className='space-y-0.5'>
          <p className='text-sm font-medium text-foreground'>
            {isDragOver ? 'Déposez ici' : 'Glissez un fichier ou un lien ici'}
          </p>
          <p className='text-xs text-muted-foreground'>
            jusqu'à {MAX_FILES_PER_UPLOAD} fichiers, max {formatFileSize(MAX_FILE_SIZE)} chacun
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className='mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90'
            >
              Ajouter <ChevronDown className='h-4 w-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='center'>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <FileUp className='mr-2 h-4 w-4' /> Importer un document
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openLink('')}>
              <Link2 className='mr-2 h-4 w-4' /> Ajouter un lien
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          ref={fileInputRef}
          type='file'
          multiple
          hidden
          accept={accept}
          onChange={(e) => {
            pushFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {selectedWorkspaceId && (
        <AddLinkDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          workspaceId={selectedWorkspaceId}
          initialUrl={linkInitialUrl}
        />
      )}
    </>
  );
}
```

Note: confirm `selectedWorkspaceId` exists on the store (it does — used in `WorkspacePage.tsx`). If the drop zone is rendered where the active workspace id is a prop/route param instead, pass that id through instead of `selectedWorkspaceId`.

- [ ] **Step 2: Verify build + existing tests**

Run: `cd front && npx tsc --noEmit && npx vitest run src/modules/workspace`
Expected: no type errors; workspace tests PASS.

- [ ] **Step 3: Commit**

```bash
git add front/src/modules/workspace/components/WorkspaceUploadDropZone.tsx
git commit -m "feat(workspace-ui): upload dropdown (document/link) + dragged-URL detection"
```

---

### Task 10: Web icon + "Conversion…" indicator in the file list

**Files:**
- Modify: `front/src/modules/workspace/components/WorkspacePage.tsx` (`getFileIcon` ~line 60; `FileRow` ~line 796)

**Interfaces:**
- Consumes: `WorkspaceFile.type`, `WorkspaceFile.indexingStatus` (Task 6).

- [ ] **Step 1: Add a link-aware icon helper**

In `WorkspacePage.tsx`, `Globe` is not yet imported — add it to the lucide-react import on line 4 (append `, Globe`). Then add a helper next to `getFileIcon` (~line 65):

```ts
function getItemIcon(file: WorkspaceFile) {
  if (file.type === 'url') return Globe;
  return getFileIcon(file.mimeType);
}
```

- [ ] **Step 2: Use it and add the converting state in `FileRow`**

In `FileRow` (~line 797) change:

```ts
  const Icon = getFileIcon(file.mimeType);
```
to:
```ts
  const Icon = getItemIcon(file);
  const isConverting = file.type === 'url' && (file.indexingStatus === 'none' || file.indexingStatus == null);
```

Then in the row body (~line 872-875), replace the status-dot + name block with a converting-aware version:

```tsx
        <div className='min-w-0 flex-1 flex items-center gap-2'>
          {isConverting ? (
            <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
              <Loader2 className='h-3.5 w-3.5 animate-spin' />
            </span>
          ) : (
            <IndexingStatusDot status={file.indexingStatus} error={file.indexingError} />
          )}
          <span className='truncate text-sm'>{file.name}</span>
        </div>
```

(`Loader2` is already imported.)

- [ ] **Step 3: Guard viewing while converting**

In `FileRow`, the "Voir" action opens the file viewer via `file.path`. A converting URL doc has no `path` yet. Change the viewable guard (~line 811) so it also requires a stored path:

```ts
  const viewable = isViewableFile(file.mimeType) && !!file.path && !isConverting;
```

- [ ] **Step 4: Verify build + tests**

Run: `cd front && npx tsc --noEmit && npx vitest run src/modules/workspace`
Expected: no type errors; tests PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/workspace/components/WorkspacePage.tsx
git commit -m "feat(workspace-ui): web icon and conversion indicator for link items"
```

---

### Task 11: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `cd back && npm test`
Expected: all suites PASS.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd front && npm test`
Expected: all suites PASS.

- [ ] **Step 3: Type-check both**

Run: `cd back && npx tsc --noEmit -p tsconfig.json` then `cd front && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual smoke (documented, requires running services + a real URL_TO_PDF_API_URL)**

With `URL_TO_PDF_API_URL`/`URL_TO_PDF_API_KEY` set and the app running:
1. Open a workspace, click **Ajouter → Ajouter un lien**, enter a reachable URL, submit. Expect: a new item with a web (globe) icon and a spinning "Conversion…" indicator.
2. After conversion, the item shows the normal indexing status dot and becomes viewable (opens the PDF in the file viewer).
3. Enter an unreachable URL. Expect: inline "injoignable" error, nothing added.
4. Drag a URL from the browser address bar onto the drop zone. Expect: the link dialog opens prefilled with that URL.

- [ ] **Step 5: Final commit (if any doc/notes changes)**

```bash
git add -A
git commit -m "chore(workspace): finalize website links feature" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** type/sourceUrl model (T1, T5, T6); convert client + config (T2); validate-url + link endpoints and async convert flow (T3, T4); indexing reuse via `queueDocument` (T3); classifier list visibility already status-agnostic (T5); upload dropdown (T9); dragged-URL detection (T7, T9); link modal with format + reachability validation (T8); web icon + converting/failed status (T10); error handling (T3 failure path, T8 modal errors); tests throughout; e2e verification (T11).
- **Extension allowlist bypass:** `addLink`/`convertAndStore` never call `validateFile`, so the internally generated PDF is not subject to the user-facing extension allowlist; storage quota is still enforced in `convertAndStore`.
- **Failure UX:** on conversion failure the doc is set to `FAILED` + `indexingStatus=FAILED` and a status notification is emitted, so the existing SSE path flips the row to a failed dot.
- **Optional (out of scope for POC):** a retry cron for url docs stuck in `PROCESSING`. Not included; a failed conversion is surfaced as `FAILED` and the user can delete/re-add.
