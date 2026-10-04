import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger';
import { ConnectorTransferAdapter } from '../interfaces/connector-transfer.interface';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

@Injectable()
export class M365TransferAdapter implements ConnectorTransferAdapter {
  readonly provider = 'm365';

  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(M365TransferAdapter.name);
  }

  private buildHeaders(authHeaders: Record<string, string>): Record<string, string> {
    return {
      Authorization: authHeaders.Authorization || '',
      ...authHeaders,
    };
  }

  private buildItemPath(itemRef: Record<string, unknown>): string {
    const driveId = itemRef.driveId as string;
    const itemId = itemRef.itemId as string;
    const path = itemRef.path as string | undefined;

    if (!driveId) {
      throw new Error('itemRef must contain driveId');
    }

    if (itemId) {
      return `/drives/${driveId}/items/${itemId}`;
    }

    if (path) {
      const encoded = encodeURIComponent(path.replace(/^\//, ''));
      return `/drives/${driveId}/root:/${encoded}`;
    }

    throw new Error('itemRef must contain itemId or path');
  }

  async resolveImportCandidates(
    itemRef: Record<string, unknown>,
    authHeaders: Record<string, string>,
    options?: { recursive?: boolean },
  ): Promise<{ itemRef: Record<string, unknown>; filename: string; mimeType: string; sourcePath: string }[]> {
    const recursive = options?.recursive ?? true;
    const headers = this.buildHeaders(authHeaders);
    const itemPath = this.buildItemPath(itemRef);
    const driveId = itemRef.driveId as string;

    const metaResp = await fetch(`${GRAPH_BASE}${itemPath}?$select=id,name,file,folder,parentReference`, {
      headers,
    });

    if (!metaResp.ok) {
      const text = await metaResp.text();
      throw new Error(`Failed to fetch item metadata: ${metaResp.status} ${text}`);
    }

    const meta = (await metaResp.json()) as Record<string, unknown>;
    const parentReference = (meta.parentReference as Record<string, unknown> | undefined) || {};
    const parentPath = ((parentReference.path as string) || '').replace(/^\/drives\/[^/]+\/root:?/, '');
    const itemName = (meta.name as string) || 'unknown';
    const sourcePath = `${parentPath}/${itemName}`.replace(/\/{2,}/g, '/');

    if (!meta.folder) {
      const file = meta.file as Record<string, unknown> | undefined;
      return [{
        itemRef: { driveId, itemId: meta.id },
        filename: itemName,
        mimeType: (file?.mimeType as string) || 'application/octet-stream',
        sourcePath,
      }];
    }

    const queue: { itemId: string; prefix: string }[] = [{
      itemId: meta.id as string,
      prefix: sourcePath.replace(/^\//, ''),
    }];
    const files: { itemRef: Record<string, unknown>; filename: string; mimeType: string; sourcePath: string }[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      let nextUrl = `${GRAPH_BASE}/drives/${driveId}/items/${current.itemId}/children?$select=id,name,file,folder,parentReference`;
      while (nextUrl) {
        const childrenResp = await fetch(nextUrl, { headers });
        if (!childrenResp.ok) {
          const text = await childrenResp.text();
          throw new Error(`Failed to list folder children: ${childrenResp.status} ${text}`);
        }

        const payload = (await childrenResp.json()) as { value?: Record<string, unknown>[]; '@odata.nextLink'?: string };
        for (const child of payload.value || []) {
          const childName = (child.name as string) || 'unknown';
          const childSourcePath = `/${current.prefix}/${childName}`.replace(/\/{2,}/g, '/');
          if (child.folder) {
            if (recursive) {
              queue.push({ itemId: child.id as string, prefix: childSourcePath.replace(/^\//, '') });
            }
            continue;
          }

          const file = child.file as Record<string, unknown> | undefined;
          files.push({
            itemRef: { driveId, itemId: child.id },
            filename: childName,
            mimeType: (file?.mimeType as string) || 'application/octet-stream',
            sourcePath: childSourcePath,
          });
        }

        nextUrl = payload['@odata.nextLink'] || '';
      }
    }

    return files;
  }

  async downloadItem(
    itemRef: Record<string, unknown>,
    authHeaders: Record<string, string>,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const itemPath = this.buildItemPath(itemRef);
    const headers = this.buildHeaders(authHeaders);

    const metaResp = await fetch(`${GRAPH_BASE}${itemPath}?$select=id,name,file,folder`, {
      headers,
    });

    if (!metaResp.ok) {
      const text = await metaResp.text();
      throw new Error(`Failed to fetch item metadata: ${metaResp.status} ${text}`);
    }

    const meta = await metaResp.json() as Record<string, unknown>;

    if (meta.folder) {
      throw new Error('Cannot download a folder');
    }

    const filename = (meta.name as string) || 'unknown';
    const file = meta.file as Record<string, unknown> | undefined;
    const mimeType = (file?.mimeType as string) || 'application/octet-stream';

    const contentResp = await fetch(`${GRAPH_BASE}${itemPath}/content`, {
      headers,
      redirect: 'follow',
    });

    if (!contentResp.ok) {
      throw new Error(`Failed to download content: ${contentResp.status}`);
    }

    const contentLength = contentResp.headers.get('content-length');
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_DOWNLOAD_BYTES) {
      throw new Error(`File too large (${Math.round(Number.parseInt(contentLength, 10) / 1024 / 1024)}MB). Maximum is ${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)}MB.`);
    }

    const arrayBuffer = await contentResp.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Downloaded file exceeds maximum size (${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)}MB)`);
    }
    return { buffer: Buffer.from(arrayBuffer), filename, mimeType };
  }

  async uploadItem(
    targetRef: Record<string, unknown>,
    authHeaders: Record<string, string>,
    content: Buffer,
    filename: string,
    mimeType: string,
    mode: 'create' | 'update',
  ): Promise<{ itemId: string; name: string; webUrl?: string }> {
    const driveId = targetRef.driveId as string;
    if (!driveId) {
      throw new Error('targetRef must contain driveId');
    }

    const headers = {
      Authorization: authHeaders.Authorization || '',
      ...authHeaders,
    };

    let uploadPath: string;

    if (mode === 'update') {
      const itemId = targetRef.itemId as string;
      if (!itemId) {
        throw new Error('targetRef must contain itemId for update mode');
      }
      uploadPath = `/drives/${driveId}/items/${itemId}/content`;
    } else {
      const parentPath = targetRef.path as string | undefined;
      const parentId = targetRef.parentId as string | undefined;
      const encodedFilename = encodeURIComponent(filename);

      if (parentId) {
        uploadPath = `/drives/${driveId}/items/${parentId}:/${encodedFilename}:/content`;
      } else if (parentPath) {
        const encodedParent = encodeURIComponent(parentPath.replace(/^\//, ''));
        uploadPath = `/drives/${driveId}/root:/${encodedParent}/${encodedFilename}:/content`;
      } else {
        uploadPath = `/drives/${driveId}/root:/${encodedFilename}:/content`;
      }
    }

    const resp = await fetch(`${GRAPH_BASE}${uploadPath}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': mimeType },
      body: new Uint8Array(content),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to upload: ${resp.status} ${text}`);
    }

    const result = (await resp.json()) as Record<string, unknown>;
    return {
      itemId: (result.id as string) || '',
      name: (result.name as string) || filename,
      webUrl: (result.webUrl as string | undefined) ?? undefined,
    };
  }
}
