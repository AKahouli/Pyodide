import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  type BlockBlobClient,
  type ContainerClient,
  type UserDelegationKey,
} from '@azure/storage-blob';
import { Readable } from 'stream';
import {
  SignedUrlOptions,
  StorageBackend,
  StorageListPage,
  StorageNotFoundError,
  StorageObjectMetadata,
  StoragePutOptions,
  StorageReadStream,
} from './types';

export interface AzureBackendConfig {
  connectionString: string;
  container: string;
  /** Opt-in: authenticate with the platform's managed identity instead of the account key. */
  useManagedIdentity?: boolean;
  /**
   * Blob endpoint, e.g. "https://acct.blob.core.windows.net". Required under
   * managed identity, where disabling shared-key access leaves no connection
   * string to read the account from.
   */
  accountUrl?: string;
}

const UPLOAD_STREAM_BUFFER_BYTES = 4 * 1024 * 1024;
const UPLOAD_STREAM_CONCURRENCY = 4;
const COPY_SOURCE_SAS_MINUTES = 10;
/** Azure caps a user delegation key at 7 days; stay inside it. */
const DELEGATION_KEY_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** Extra validity requested beyond the SAS itself, so one key serves several URLs. */
const DELEGATION_KEY_HEADROOM_MS = 60 * 60 * 1000;
/** Clock-skew allowance on both ends of the delegation window. */
const DELEGATION_KEY_SKEW_MS = 5 * 60 * 1000;

/**
 * Account endpoint and name, read from the connection string.
 *
 * Managed identity uses the same `AZURE_STORAGE_CONNECTION_STRING` as the key
 * mode, minus `AccountKey` — so a deployment switches credentials without
 * changing where the account is declared.
 */
export function parseAzureAccount(connectionString: string): { url: string; name: string } {
  const settings = new Map<string, string>();
  for (const part of connectionString.split(';')) {
    const separator = part.indexOf('=');
    // AccountKey values are base64 and contain '=', so split on the first one only.
    if (separator > 0) settings.set(part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim());
  }

  // An empty value is as good as an absent one: fall through to the fallback.
  const setting = (key: string, fallback: string): string => {
    const value = settings.get(key)?.trim();
    if (!value) return fallback;
    return value;
  };

  const endpoint = setting('blobendpoint', '');
  const name = setting('accountname', endpoint ? hostAccountName(endpoint) : '');
  if (!name) throw new Error('Azure storage connection string carries neither AccountName nor BlobEndpoint');
  if (endpoint) return { url: endpoint.replace(/\/+$/, ''), name };

  return {
    url: `${setting('defaultendpointsprotocol', 'https')}://${name}.blob.${setting('endpointsuffix', 'core.windows.net')}`,
    name,
  };
}

function hostAccountName(endpoint: string): string {
  try {
    return new URL(endpoint).hostname.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

/** Account endpoint and name read from a blob endpoint URL. */
export function parseAzureAccountUrl(accountUrl: string): { url: string; name: string } {
  const name = hostAccountName(accountUrl);
  if (!name) throw new Error('AZURE_STORAGE_ACCOUNT_URL is not a valid blob endpoint URL');
  return { url: accountUrl.replace(/\/+$/, ''), name };
}

/**
 * Azure Blob / Data Lake Gen2 backend.
 *
 * A Gen2 account (hierarchical namespace enabled) is fully reachable through
 * the Blob API, and our object keys are already flat paths
 * ("user/folder/file.txt") that map 1:1 onto blob names. So this uses
 * @azure/storage-blob rather than @azure/storage-file-datalake, whose
 * directory semantics we do not need.
 *
 * Two credentials are supported, and every operation behaves identically under
 * both. By default the account connection string carries an account key, which
 * signs SAS URLs directly. With `useManagedIdentity`, no key exists, so SAS
 * URLs are signed with a user delegation key obtained from the service — the
 * account itself still being named by the same connection string.
 */
export class AzureStorageBackend implements StorageBackend {
  readonly label = 'Azure Blob';

  private service: BlobServiceClient | null = null;
  private container: ContainerClient | null = null;
  private accountName = '';
  private delegation: { key: UserDelegationKey; expiresOn: Date } | null = null;

  constructor(private readonly config: AzureBackendConfig) {}

  async connect(): Promise<void> {
    if (this.config.useManagedIdentity) {
      const account = this.resolveAccount();
      // Imported here so key-based and Ceph deployments never load the identity stack.
      const { DefaultAzureCredential } = await import('@azure/identity');
      this.accountName = account.name;
      this.service = new BlobServiceClient(account.url, new DefaultAzureCredential());
    } else {
      this.service = BlobServiceClient.fromConnectionString(this.config.connectionString);
    }

    this.container = this.service.getContainerClient(this.config.container);
    await this.container.createIfNotExists();
  }

  async verify(): Promise<void> {
    await this.requireContainer().getProperties();
  }

  destroy(): void {
    this.container = null;
    this.service = null;
    this.delegation = null;
  }

  async head(key: string): Promise<StorageObjectMetadata | null> {
    try {
      const properties = await this.blob(key).getProperties();
      // A directory entry is not an object; S3 has no equivalent to report.
      if (isDirectoryMarker(properties.metadata)) return null;

      return {
        sizeBytes: properties.contentLength || 0,
        contentType: properties.contentType,
        lastModified: properties.lastModified,
        metadata: properties.metadata,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getStream(key: string, range?: string): Promise<StorageReadStream> {
    const blob = this.blob(key);

    try {
      const { offset, count } = range
        ? await this.resolveRange(blob, range)
        : { offset: 0, count: undefined };

      const response = await blob.download(offset, count);
      if (!response.readableStreamBody) throw new StorageNotFoundError(key);

      return {
        body: response.readableStreamBody as Readable,
        contentType: response.contentType,
        contentLength: response.contentLength,
        contentRange: response.contentRange,
        acceptRanges: response.acceptRanges ?? 'bytes',
        ...(response.metadata ? { metadata: response.metadata } : {}),
      };
    } catch (error) {
      if (error instanceof StorageNotFoundError) throw error;
      if (isNotFound(error)) throw new StorageNotFoundError(key);
      throw error;
    }
  }

  async put(key: string, body: Buffer | Readable, options: StoragePutOptions): Promise<void> {
    const blob = this.blob(key);
    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: options.contentType,
        ...(options.cacheControl ? { blobCacheControl: options.cacheControl } : {}),
      },
      ...(options.metadata ? { metadata: sanitizeMetadata(options.metadata) } : {}),
    };

    if (Buffer.isBuffer(body)) {
      await blob.upload(body, body.byteLength, uploadOptions);
      return;
    }

    await blob.uploadStream(
      body,
      UPLOAD_STREAM_BUFFER_BYTES,
      UPLOAD_STREAM_CONCURRENCY,
      uploadOptions,
    );
  }

  async delete(key: string): Promise<void> {
    await this.blob(key).deleteIfExists();
  }

  async list(
    prefix: string | undefined,
    maxKeys: number,
    continuationToken?: string,
  ): Promise<StorageListPage> {
    // includeMetadata is required to spot the directory entries that a
    // hierarchical-namespace (Data Lake Gen2) account creates on its own:
    // writing "a/b/c.txt" materialises "a" and "a/b", and those survive the
    // deletion of every blob under them. They are not documents, and S3 has
    // no equivalent, so they must not reach callers.
    const pages = this.requireContainer()
      .listBlobsFlat({ includeMetadata: true, ...(prefix ? { prefix } : {}) })
      .byPage({ maxPageSize: maxKeys, continuationToken });

    // Filtering directories can empty a page that still has pages behind it, so
    // keep pulling until something real shows up. Only all-directory pages are
    // skipped, so no page is ever returned twice and nothing overshoots maxKeys.
    let objects: StorageListPage['objects'] = [];
    let token: string | undefined = continuationToken;

    do {
      const { value, done } = await pages.next();
      if (done || !value) {
        token = undefined;
        break;
      }

      const items: Array<{
        name: string;
        metadata?: Record<string, string>;
        properties?: { contentLength?: number; lastModified?: Date };
      }> = value.segment?.blobItems ?? [];

      objects = items
        .filter((item) => !isDirectoryMarker(item.metadata))
        .map((item) => ({
          key: item.name,
          sizeBytes: item.properties?.contentLength || 0,
          lastModified: item.properties?.lastModified,
        }));
      token = value.continuationToken || undefined;
    } while (objects.length === 0 && token);

    return { objects, continuationToken: token };
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    // Server-side copy; the source URL must carry a SAS for Azure to read it.
    const sourceUrl = await this.sasUrl(
      sourceKey,
      BlobSASPermissions.parse('r'),
      minutesFromNow(COPY_SOURCE_SAS_MINUTES),
    );

    await this.blob(destinationKey).syncCopyFromURL(sourceUrl);
  }

  async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    return this.sasUrl(
      key,
      // "cw" mirrors the S3 presigned PutObject this replaces: create + write.
      BlobSASPermissions.parse(options.write ? 'cw' : 'r'),
      new Date(Date.now() + options.expirySeconds * 1000),
      options.contentDisposition,
    );
  }

  publicUrl(key: string): string {
    return this.blob(key).url;
  }

  // ============ Private ============

  private requireContainer(): ContainerClient {
    if (!this.container) throw new Error('Azure Blob client not initialized');
    return this.container;
  }

  private blob(key: string): BlockBlobClient {
    return this.requireContainer().getBlockBlobClient(key);
  }

  /**
   * One SAS URL, signed with whichever credential is configured. The account
   * key signs locally; a managed identity has no key, so the service issues a
   * user delegation key that signs on its behalf.
   */
  private async sasUrl(
    key: string,
    permissions: BlobSASPermissions,
    expiresOn: Date,
    contentDisposition?: string,
  ): Promise<string> {
    const blob = this.blob(key);
    const disposition = contentDisposition ? { contentDisposition } : {};

    if (!this.config.useManagedIdentity) {
      return blob.generateSasUrl({ permissions, expiresOn, ...disposition });
    }

    const query = generateBlobSASQueryParameters(
      {
        containerName: this.config.container,
        blobName: key,
        permissions,
        expiresOn,
        ...disposition,
      },
      await this.userDelegationKey(expiresOn),
      this.accountName,
    ).toString();

    return `${blob.url}?${query}`;
  }

  /**
   * A delegation key is reused across SAS URLs until it can no longer outlive
   * the one being signed — a SAS never outlives the key that signed it.
   */
  private async userDelegationKey(expiresOn: Date): Promise<UserDelegationKey> {
    if (this.delegation && this.delegation.expiresOn.getTime() > expiresOn.getTime() + DELEGATION_KEY_SKEW_MS) {
      return this.delegation.key;
    }

    const now = Date.now();
    const until = new Date(
      Math.min(expiresOn.getTime() + DELEGATION_KEY_HEADROOM_MS, now + DELEGATION_KEY_MAX_MS),
    );
    if (until.getTime() <= expiresOn.getTime()) {
      throw new Error('Requested SAS expiry exceeds the 7-day limit of an Azure user delegation key');
    }

    const key = await this.requireService().getUserDelegationKey(new Date(now - DELEGATION_KEY_SKEW_MS), until);
    this.delegation = { key, expiresOn: until };
    return key;
  }

  private requireService(): BlobServiceClient {
    if (!this.service) throw new Error('Azure Blob client not initialized');
    return this.service;
  }

  /**
   * Where the account lives, under managed identity. The account URL is the
   * normal source: disabling shared-key access removes the connection string
   * entirely. A keyless connection string is still accepted, so a deployment
   * can switch credentials before retiring the variable.
   */
  private resolveAccount(): { url: string; name: string } {
    if (this.config.accountUrl) return parseAzureAccountUrl(this.config.accountUrl);
    if (this.config.connectionString) return parseAzureAccount(this.config.connectionString);
    throw new Error('Azure managed identity requires AZURE_STORAGE_ACCOUNT_URL');
  }

  /**
   * Translate an HTTP byte range into Azure's offset/count pair. Azure has no
   * equivalent of the suffix form ("bytes=-500"), so that one is resolved
   * against the blob length.
   */
  private async resolveRange(
    blob: BlockBlobClient,
    range: string,
  ): Promise<{ offset: number; count: number | undefined }> {
    const [rawStart, rawEnd] = range.replace('bytes=', '').split('-');

    if (rawStart === '') {
      const suffixLength = Number(rawEnd);
      const { contentLength = 0 } = await blob.getProperties();
      const offset = Math.max(0, contentLength - suffixLength);
      return { offset, count: contentLength - offset };
    }

    const offset = Number(rawStart);
    if (rawEnd === '' || rawEnd === undefined) return { offset, count: undefined };
    return { offset, count: Number(rawEnd) - offset + 1 };
  }
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * Azure metadata names must be valid C# identifiers, so hyphens — legal in S3
 * metadata — would make the whole upload fail with 400. Map them to
 * underscores rather than losing the upload.
 */
function sanitizeMetadata(metadata: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(?=\d)/, '_')] = value;
  }
  return sanitized;
}

/**
 * Data Lake Gen2 flags its auto-created directory entries with this metadata
 * key. They list like zero-byte blobs but are not objects.
 */
function isDirectoryMarker(metadata?: Record<string, string>): boolean {
  return metadata?.hdi_isfolder === 'true';
}

function isNotFound(error: unknown): boolean {
  const err = error as { statusCode?: number; code?: string; details?: { errorCode?: string } };
  return (
    err?.statusCode === 404 ||
    err?.code === 'BlobNotFound' ||
    err?.code === 'ContainerNotFound' ||
    err?.details?.errorCode === 'BlobNotFound'
  );
}
