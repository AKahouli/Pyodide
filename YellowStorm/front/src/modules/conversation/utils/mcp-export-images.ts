import { confirmFileUpload, fetchConversationAssets, requestFileUploadUrl } from '../api';
import type { OpenUiExportPart } from '../components/openui/plain-text';

export type McpExportManifest = { parts: Array<OpenUiExportPart & { componentId?: string }> };

function hasCompletePngChunks(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, sawData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) return false;
    if (type === 'IDAT') sawData = true;
    if (type === 'IEND') return length === 0 && end === bytes.length && sawData;
    offset = end;
  }
  return false;
}

function decodeImage(source: string): { bytes: Uint8Array<ArrayBuffer>; mimeType: string; extension: string } {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  if (!match || match[2].length % 4 !== 0 || match[2].length > 70_000_000) throw new Error('Invalid inline export image');
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const png = match[1] === 'png';
  const valid = png
    ? bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
      && [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130].every((byte, index) => bytes[bytes.length - 12 + index] === byte)
      && hasCompletePngChunks(bytes)
    : bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  if (!valid) throw new Error('Incomplete inline export image');
  return { bytes, mimeType: `image/${match[1]}`, extension: png ? 'png' : 'jpg' };
}

/** Persist captured visuals using the conversation's existing quota/upload owner. */
export async function persistMcpExportImages<T extends McpExportManifest>(conversationId: string, manifest: T, assertCurrent: () => void): Promise<T> {
  const sources = new Map<string, string>();
  async function lookup(filename: string, mimeType: string, documentId: string): Promise<string | undefined> {
    let cursor: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      assertCurrent();
      const result = await fetchConversationAssets(conversationId, { search: filename, kind: 'image', limit: 50, cursor });
      assertCurrent();
      if (result.sourceErrors?.includes('upload')) throw new Error('Export image discovery unavailable');
      const asset = result.assets.find(item => item.status === 'ready'
        && item.mimeType === mimeType && item.actions.read && item.documentId === documentId);
      if (asset) return `conversation-asset:${asset.ref}`;
      if (!result.nextCursor || result.nextCursor === cursor) return undefined;
      cursor = result.nextCursor;
    }
    throw new Error('Export image discovery limit reached');
  }
  const parts: T['parts'] = [];
  for (const part of manifest.parts) {
    assertCurrent();
    if (part.kind !== 'image' || !part.source.startsWith('data:')) { parts.push(part); continue; }
    let source = sources.get(part.source);
    if (!source) {
      const image = decodeImage(part.source);
      const digest = await crypto.subtle.digest('SHA-256', image.bytes);
      assertCurrent();
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      const filename = `OpenUI-snapshot-${hash}.${image.extension}`;
      {
        const file = new File([image.bytes], filename, { type: image.mimeType });
        assertCurrent();
        const upload = await requestFileUploadUrl(conversationId, { filename, mimeType: image.mimeType, size: file.size });
        assertCurrent();
        const { uploadToAzure } = await import('@/modules/workspace');
        assertCurrent();
        await uploadToAzure(upload.uploadUrl, file);
        assertCurrent();
        await confirmFileUpload(conversationId, upload.documentId);
        assertCurrent();
        source = await lookup(filename, image.mimeType, upload.documentId);
        assertCurrent();
        if (!source) throw new Error('Uploaded export image is unavailable');
      }
      sources.set(part.source, source);
    }
    parts.push({ ...part, source });
  }
  assertCurrent();
  return { ...manifest, parts };
}
