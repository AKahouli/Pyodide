import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistMcpExportImages, type McpExportManifest } from './mcp-export-images';
import { confirmFileUpload, fetchConversationAssets, requestFileUploadUrl } from '../api';
import { uploadToAzure } from '@/modules/workspace';

vi.mock('../api', () => ({ confirmFileUpload: vi.fn(), fetchConversationAssets: vi.fn(), requestFileUploadUrl: vi.fn() }));
vi.mock('@/modules/workspace', () => ({ uploadToAzure: vi.fn() }));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6EVEAAAAASUVORK5CYII=';
const manifest = (): McpExportManifest => ({ parts: [{ kind: 'image', source: png, caption: 'Revenue', componentId: 'chart-1' }, { kind: 'markdown', markdown: 'Saved view' }] });
const asset = (name: string, documentId = 'new') => ({ ref: 'opaque', name, status: 'ready', mimeType: 'image/png', documentId, actions: { read: true } });
describe('MCP export image persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchConversationAssets).mockResolvedValue({ assets: [], nextCursor: null });
    vi.mocked(requestFileUploadUrl).mockResolvedValue({ documentId: 'new', uploadUrl: 'upload', expiresAt: '' });
  });
  it('ignores same-name foreign bytes and resolves only its exact uploaded document, preserving metadata', async () => {
    vi.mocked(fetchConversationAssets).mockResolvedValue({ assets: [asset('same.png', 'old') as never, asset('same_(1).png') as never], nextCursor: null });
    const result = await persistMcpExportImages('conversation', manifest(), () => {});
    expect(result.parts[0]).toEqual({ kind: 'image', source: 'conversation-asset:opaque', caption: 'Revenue', componentId: 'chart-1' });
    expect(requestFileUploadUrl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('base64');
    expect(fetchConversationAssets).toHaveBeenCalledWith('conversation', { kind: 'image', limit: 50, cursor: undefined });
    expect(requestFileUploadUrl).toHaveBeenCalledWith('conversation', expect.objectContaining({ filename: expect.stringMatching(/^OpenUI-snapshot-[a-f0-9]{64}\.png$/) }));
  });
  it('finds the exact confirmed document after server renaming and across pages without filename filtering', async () => {
    vi.mocked(fetchConversationAssets).mockImplementation(async (_conversation, params) => {
      const filename = vi.mocked(requestFileUploadUrl).mock.calls[0][1].filename;
      const renamed = filename.replace('.png', '_(1).png');
      const rows = params?.cursor ? [asset(renamed)] : [asset(filename, 'old')];
      // Simulate the server's literal name filtering, which excludes hash_(1).png when queried with hash.png.
      const filtered = params?.search ? rows.filter(row => row.name.includes(params.search!)) : rows;
      return { assets: filtered as never[], nextCursor: params?.cursor ? null : 'second-page' };
    });
    const result = await persistMcpExportImages('conversation', manifest(), () => {});
    expect(result.parts[0]).toMatchObject({ source: 'conversation-asset:opaque' });
    expect(fetchConversationAssets).toHaveBeenNthCalledWith(2, 'conversation', { kind: 'image', limit: 50, cursor: 'second-page' });
    expect(vi.mocked(fetchConversationAssets).mock.calls.every(([, params]) => params?.search === undefined)).toBe(true);
  });
  it('never substitutes a preexisting document with the same hash filename', async () => {
    vi.mocked(fetchConversationAssets).mockResolvedValue({ assets: [asset('same.png', 'old') as never], nextCursor: null });
    await expect(persistMcpExportImages('conversation', manifest(), () => {})).rejects.toThrow('unavailable');
  });
  it('uploads once, confirms and resolves the stable authorized reference for duplicate visuals', async () => {
    vi.mocked(fetchConversationAssets).mockImplementation(async () => ({ assets: vi.mocked(confirmFileUpload).mock.calls.length ? [asset('saved.png') as never] : [], nextCursor: null }));
    const input = manifest(); input.parts.push(input.parts[0]);
    await persistMcpExportImages('conversation', input, () => {});
    expect(requestFileUploadUrl).toHaveBeenCalledTimes(1);
    expect(uploadToAzure).toHaveBeenCalledWith('upload', expect.any(File));
    expect(confirmFileUpload).toHaveBeenCalledWith('conversation', 'new');
  });
  it('propagates quota failures without transfer or substitution', async () => {
    vi.mocked(requestFileUploadUrl).mockRejectedValue(new Error('quota'));
    await expect(persistMcpExportImages('conversation', manifest(), () => {})).rejects.toThrow('quota');
    expect(uploadToAzure).not.toHaveBeenCalled();
  });
  it('stops before transfer when actor/conversation changes during URL creation', async () => {
    let current = true;
    vi.mocked(requestFileUploadUrl).mockImplementation(async () => { current = false; return { documentId: 'new', uploadUrl: 'upload', expiresAt: '' }; });
    await expect(persistMcpExportImages('conversation', manifest(), () => { if (!current) throw new Error('scope changed'); })).rejects.toThrow('scope changed');
    expect(uploadToAzure).not.toHaveBeenCalled(); expect(confirmFileUpload).not.toHaveBeenCalled();
  });
  it('fails if confirmation or final authorized discovery fails', async () => {
    vi.mocked(confirmFileUpload).mockRejectedValue(new Error('confirm'));
    await expect(persistMcpExportImages('conversation', manifest(), () => {})).rejects.toThrow('confirm');
    vi.mocked(confirmFileUpload).mockResolvedValue({ id: 'new', originalName: '', mimeType: '', size: 1 });
    await expect(persistMcpExportImages('conversation', manifest(), () => {})).rejects.toThrow('unavailable');
  });
  it.each(['data:image/png;base64,aGVsbG8=', png.slice(0, -4), 'data:image/jpeg;base64,/9j/AA=='])('rejects malformed or truncated bytes', async source => {
    await expect(persistMcpExportImages('conversation', { parts: [{ kind: 'image', source, caption: '' }] }, () => {})).rejects.toThrow();
    expect(requestFileUploadUrl).not.toHaveBeenCalled();
  });
});
