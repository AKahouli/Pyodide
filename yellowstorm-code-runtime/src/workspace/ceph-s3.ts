import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { RuntimeError } from "../runtime/errors.js";
import type { ObjectStore } from "./types.js";

export interface CephConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export class CephS3Store implements ObjectStore {
  private readonly client: S3Client;

  constructor(private readonly config: CephConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    });
  }

  async head(key: string, signal: AbortSignal): Promise<{ sizeBytes: number; contentType?: string } | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: signal });
      return {
        sizeBytes: result.ContentLength ?? 0,
        ...(result.ContentType ? { contentType: result.ContentType } : {})
      };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw new RuntimeError("CEPH_UNAVAILABLE", "Workspace storage is unavailable.", 503);
    }
  }

  async list(prefix: string, delimiter: string, maxKeys: number, signal: AbortSignal) {
    try {
      const result = await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix,
        Delimiter: delimiter,
        MaxKeys: maxKeys
      }), { abortSignal: signal });
      return {
        files: (result.Contents ?? []).flatMap((item) => item.Key ? [{ key: item.Key, sizeBytes: item.Size ?? 0 }] : []),
        prefixes: (result.CommonPrefixes ?? []).flatMap((item) => item.Prefix ? [item.Prefix] : []),
        truncated: result.IsTruncated === true
      };
    } catch {
      throw new RuntimeError("CEPH_UNAVAILABLE", "Workspace storage is unavailable.", 503);
    }
  }

  async read(key: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: signal });
      if (!result.Body) throw new RuntimeError("FILE_NOT_FOUND", "Workspace file was not found.", 404);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
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
      throw new RuntimeError("CEPH_UNAVAILABLE", "Workspace storage is unavailable.", 503);
    }
  }

  async write(key: string, body: Uint8Array, contentType: string, signal: AbortSignal): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType
      }), { abortSignal: signal });
    } catch {
      throw new RuntimeError("CEPH_UNAVAILABLE", "Workspace storage is unavailable.", 503);
    }
  }
}
