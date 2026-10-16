import { BlobSASPermissions, BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { RuntimeError } from "../runtime/errors.js";
import type { ObjectStore } from "./types.js";

export interface AzureConfig {
  connectionString: string;
  container: string;
}

const COPY_SOURCE_SAS_MS = 10 * 60 * 1000;

/**
 * Azure Blob / Data Lake Gen2 backend. A Gen2 account (hierarchical namespace)
 * is fully reachable through the Blob API, and our object keys are already flat
 * paths ("user/folder/file.txt") that map 1:1 onto blob names — so the Blob SDK
 * is used rather than @azure/storage-file-datalake, whose directory semantics
 * we do not need.
 */
export class AzureBlobStore implements ObjectStore {
  private readonly container: ContainerClient;

  constructor(config: AzureConfig) {
    this.container = BlobServiceClient
      .fromConnectionString(config.connectionString)
      .getContainerClient(config.container);
  }

  async head(key: string, signal: AbortSignal) {
    try {
      const properties = await this.container.getBlockBlobClient(key).getProperties({ abortSignal: signal });
      // A Data Lake Gen2 directory entry is not a file; S3 has no equivalent.
      if (properties.metadata?.hdi_isfolder === "true") return null;

      return {
        sizeBytes: properties.contentLength ?? 0,
        ...(properties.contentType ? { contentType: properties.contentType } : {}),
        ...(properties.lastModified ? { modifiedAt: properties.lastModified.toISOString() } : {})
      };
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw unavailable();
    }
  }

  async list(prefix: string, delimiter: string, maxKeys: number, signal: AbortSignal, continuationToken?: string) {
    try {
      // S3 treats an empty delimiter as a flat listing; Azure needs a separate call.
      // includeMetadata is required to spot the directory entries a
      // hierarchical-namespace (Data Lake Gen2) account creates on its own:
      // writing "a/b/c.txt" materialises "a" and "a/b", they survive the
      // deletion of every blob under them, and they are not files.
      const options = { prefix, abortSignal: signal, includeMetadata: true };
      const pages = (delimiter
        ? this.container.listBlobsByHierarchy(delimiter, options)
        : this.container.listBlobsFlat(options)
      ).byPage({
        maxPageSize: maxKeys,
        ...(continuationToken ? { continuationToken } : {})
      });

      // Filtering directories can empty a page that still has pages behind it,
      // so keep pulling until something real shows up. Only all-directory
      // pages are skipped, so no page is returned twice.
      let files: Array<{ key: string; sizeBytes: number; modifiedAt?: string; contentType?: string }> = [];
      let prefixes: string[] = [];
      let token: string | undefined = continuationToken;

      do {
        const { value, done } = await pages.next();
        if (done || !value) {
          token = undefined;
          break;
        }

        // Flat and hierarchy segments differ: only the latter carries prefixes.
        const segment = value.segment as {
          blobItems?: Array<{
            name: string;
            metadata?: Record<string, string>;
            properties?: { contentLength?: number; lastModified?: Date; contentType?: string };
          }>;
          blobPrefixes?: Array<{ name: string }>;
        } | undefined;
        const items = segment?.blobItems ?? [];

        files = items
          .filter((item) => item.metadata?.hdi_isfolder !== "true")
          .map((item) => ({
            key: item.name,
            sizeBytes: item.properties?.contentLength ?? 0,
            ...(item.properties?.lastModified ? { modifiedAt: item.properties.lastModified.toISOString() } : {}),
            ...(item.properties?.contentType ? { contentType: item.properties.contentType } : {})
          }));
        prefixes = (segment?.blobPrefixes ?? []).map((item) => item.name);
        token = value.continuationToken || undefined;
      } while (files.length === 0 && prefixes.length === 0 && token);

      return {
        files,
        prefixes,
        truncated: Boolean(token),
        ...(token ? { nextContinuationToken: token } : {})
      };
    } catch {
      throw unavailable();
    }
  }

  async read(key: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
    try {
      const response = await this.container.getBlockBlobClient(key).download(undefined, undefined, { abortSignal: signal });
      const body = response.readableStreamBody;
      if (!body) throw new RuntimeError("FILE_NOT_FOUND", "Workspace file was not found.", 404);

      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > maxBytes) throw new RuntimeError("FILE_TOO_LARGE", "Workspace file is too large.");
        chunks.push(chunk);
      }
      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return output;
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      if (statusOf(error) === 404) throw new RuntimeError("FILE_NOT_FOUND", "Workspace file was not found.", 404);
      throw unavailable();
    }
  }

  async write(key: string, body: Uint8Array, contentType: string, signal: AbortSignal): Promise<void> {
    try {
      await this.container.getBlockBlobClient(key).upload(body, body.byteLength, {
        blobHTTPHeaders: { blobContentType: contentType },
        abortSignal: signal
      });
    } catch {
      throw unavailable();
    }
  }

  async copy(
    sourceKey: string,
    destinationKey: string,
    options: { overwrite: boolean },
    signal: AbortSignal
  ): Promise<{ sizeBytes: number; contentType?: string }> {
    try {
      if (!options.overwrite && await this.head(destinationKey, signal)) {
        throw new RuntimeError("DESTINATION_EXISTS", "Destination file already exists.", 409);
      }
      const source = await this.head(sourceKey, signal);
      if (!source) throw new RuntimeError("FILE_NOT_FOUND", "Workspace file was not found.", 404);

      // Server-side copy; the source URL must carry a SAS for Azure to read it,
      // even within the same storage account.
      const sourceUrl = await this.container.getBlockBlobClient(sourceKey).generateSasUrl({
        permissions: BlobSASPermissions.parse("r"),
        expiresOn: new Date(Date.now() + COPY_SOURCE_SAS_MS)
      });

      await this.container.getBlockBlobClient(destinationKey).syncCopyFromURL(sourceUrl, {
        abortSignal: signal,
        ...(options.overwrite ? {} : { conditions: { ifNoneMatch: "*" } })
      });

      return {
        sizeBytes: source.sizeBytes,
        ...(source.contentType ? { contentType: source.contentType } : {})
      };
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      const status = statusOf(error);
      if (status === 409 || status === 412) {
        throw new RuntimeError("DESTINATION_EXISTS", "Destination file already exists.", 409);
      }
      throw unavailable();
    }
  }

  async delete(key: string, signal: AbortSignal): Promise<void> {
    try {
      await this.container.getBlockBlobClient(key).deleteIfExists({ abortSignal: signal });
    } catch {
      throw unavailable();
    }
  }
}

function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number; response?: { status?: number } })?.statusCode
    ?? (error as { response?: { status?: number } })?.response?.status;
}

// Error code kept as CEPH_UNAVAILABLE: it is part of the HTTP contract clients
// already match on, and renaming it would be a breaking change for no gain.
function unavailable(): RuntimeError {
  return new RuntimeError("CEPH_UNAVAILABLE", "Workspace storage is unavailable.", 503);
}
