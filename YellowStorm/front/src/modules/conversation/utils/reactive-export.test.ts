import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { buildMcpExportManifest, buildStructuredExportBlocks } from './document-export';
import { dashboardExamples } from '../components/openui/dashboard-examples';
import { registerMiniAppExportGuard, type MiniAppStateIdentity } from '../components/openui/mini-app-state';
import type { Message } from '../types';
import { exportBlocksToHtml } from './html-export';

const fetchState = vi.hoisted(() => vi.fn());
const fetchFiles = vi.hoisted(() => vi.fn());
const fetchResult = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ fetchOpenUiAppState: fetchState, fetchConversationFiles: fetchFiles, fetchMessage: fetchResult }));
vi.mock('./docx-capture', () => ({
  captureOpenUiSvgPng: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,c3Zn', width: 200, height: 100 })),
  captureOpenUiChartPng: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,Y2hhcnQ=', width: 640, height: 320 })),
}));
const labels = { user: 'User', assistant: 'Assistant' };
const source = (program: string): Message => ({ id: 'answer', conversationId: 'conversation', conversationType: 'ai', isComplete: true,
  createdAt: '2026-10-18T10:00:00Z', components: [{ id: 'part', type: 'text', data: { content: program } }] } as Message);
async function saved(program: string, state: Record<string, unknown>) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(program));
  const programDigest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const snapshot = { schemaVersion: 1, libraryVersion: 'yellowstorm-miniapp-v1', programDigest, stateRevision: 3, state, updatedAt: null };
  fetchState.mockResolvedValue(snapshot);
  return { identity: { userId: 'owner', conversationId: 'conversation', messageId: 'answer', componentId: 'part', programDigest } as MiniAppStateIdentity, snapshot };
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks(); });
describe('authenticated reactive dashboard exports', () => {
  it.each(['sales', 'operations'] as const)('freezes saved %s controls and visuals for local and MCP formats after remount', async app => {
    const program = dashboardExamples[app];
    await saved(program, app === 'sales' ? { $minimum: 100, $includeReturns: false } : { $window: 3, $showFlow: true });
    const message = source(program);
    const blocks = await buildStructuredExportBlocks([message], labels, undefined, undefined, [], 'owner');
    expect(blocks[0].parts?.some(part => part.kind === 'image')).toBe(true);
    expect(blocks[0].markdown).toContain(app === 'sales' ? 'North: 120' : '2026-10-04: 12.0');
    expect(blocks[0].markdown).toContain(app === 'sales' ? '100' : '3');
    const manifest = await buildMcpExportManifest(message, [], 'owner');
    expect(manifest.parts.map(({ componentId: _id, ...part }) => part)).toEqual(blocks[0].parts);
    expect(exportBlocksToHtml(blocks, 'Dashboard').size).toBeGreaterThan(100);
    expect(message.components?.[0].data.content).toBe(program);
  });
  it('requires explicit authenticated scope and propagates access rejection', async () => {
    const message = source(dashboardExamples.sales);
    await expect(buildStructuredExportBlocks([message], labels)).rejects.toThrow('private dashboard');
    expect(fetchState).not.toHaveBeenCalled();
    fetchState.mockRejectedValue(new Error('Forbidden'));
    await expect(buildStructuredExportBlocks([message], labels, undefined, undefined, [], 'other')).rejects.toThrow('Forbidden');
    expect(fetchState.mock.calls[0][0].userId).toBe('other');
  });
  it('matches revision-zero actor-owned accepted fallback without using foreign or replaced-program submissions', async () => {
    const { snapshot } = await saved(dashboardExamples.sales, {});
    fetchState.mockResolvedValue({ ...snapshot, stateRevision: 0 });
    const interaction = { type: 'openui' as const, schemaVersion: 1 as const, actionType: 'continue_conversation' as const, formName: 'sales', sourceMessageId: 'answer', componentId: 'part', formState: { $minimum: 100, $includeReturns: false } };
    const own = { id: 'submission', senderId: 'owner', conversationType: 'user', conversationId: 'conversation', createdAt: '2026-10-18T10:00:00Z', interaction } as Message;
    const foreign = { ...own, id: 'foreign', senderId: 'other', createdAt: '2026-10-18T11:00:00Z', interaction: { ...interaction, formState: { $minimum: 999 } } } as Message;
    const replaced = { ...own, id: 'replaced', createdAt: '2026-10-18T12:00:00Z', interaction: { ...interaction, formState: { $minimum: 999 }, appTask: { schemaVersion: 1, programDigest: 'old', stateRevision: 1, documentIds: [] } } } as Message;
    const manifest = await buildMcpExportManifest(source(dashboardExamples.sales), [own, foreign, replaced], 'owner');
    const markdown = manifest.parts.flatMap(part => part.kind === 'markdown' ? [part.markdown] : []).join('\n');
    expect(markdown).toContain('North: 120');
    expect(markdown).toContain('Minimum revenue: 100');
    expect(markdown).not.toContain('999');
  });
  it('flushes before fetching and verifies the acknowledged snapshot before capture', async () => {
    const { identity, snapshot } = await saved(dashboardExamples.sales, { $minimum: 100 });
    const guard = vi.fn(async () => {});
    const cleanup = registerMiniAppExportGuard(identity, guard);
    try {
      await buildMcpExportManifest(source(dashboardExamples.sales), [], 'owner');
      expect(guard.mock.calls).toEqual([[undefined], [snapshot]]);
      expect(guard.mock.invocationCallOrder[0]).toBeLessThan(fetchState.mock.invocationCallOrder[0]);
    } finally { cleanup(); }
  });
  it('fails closed for changed programs and blocked drafts without producing a manifest', async () => {
    const { identity } = await saved(dashboardExamples.sales, {});
    const cleanup = registerMiniAppExportGuard(identity, async () => { throw new Error('Conflict'); });
    try {
      await expect(buildMcpExportManifest(source(dashboardExamples.sales), [], 'owner')).rejects.toThrow('Conflict');
      expect(fetchState).not.toHaveBeenCalled();
    } finally { cleanup(); }
    fetchState.mockResolvedValue({ schemaVersion: 1, programDigest: 'different' });
    await expect(buildMcpExportManifest(source(dashboardExamples.sales), [], 'owner')).rejects.toThrow('Invalid mini-app');
  });
  it('restores only the authorized matching completed document result without rerunning a task', async () => {
    const program = 'root = Card([app])\n$doc = "012345678901234567890123"\napp = MiniApp("reader", "Reader", "Saved result", [doc, result])\ndoc = MiniDocument("doc", "Document", $doc)\nresult = MiniTaskResult("Summary", {documentId:$doc})';
    const { identity, snapshot } = await saved(program, { $doc: '012345678901234567890123' });
    fetchFiles.mockResolvedValue({ documents: [{ id: '012345678901234567890123', originalName: 'brief.pdf', status: 'completed' }], pagination: { totalPages: 1 } });
    const task = { id: 'task', conversationId: 'conversation', senderId: 'owner', conversationType: 'user', createdAt: '2026-10-18', answerMessageId: 'result',
      interaction: { type: 'openui', schemaVersion: 1, actionType: 'continue_conversation', formState: {}, sourceMessageId: 'answer', componentId: 'part', formName: 'reader', params: { inputs: { documentId: '012345678901234567890123' } }, appTask: { schemaVersion: 1, documentIds: ['012345678901234567890123'], programDigest: identity.programDigest, stateRevision: snapshot.stateRevision } } } as Message;
    fetchResult.mockResolvedValue({ ...source('The saved result has a zero budget.'), id: 'result', questionMessageId: 'task' });
    const [block] = await buildStructuredExportBlocks([source(program)], labels, undefined, undefined, [task], 'owner');
    expect(block.markdown).toContain('brief.pdf');
    expect(block.markdown).toContain('The saved result has a zero budget.');
    expect(fetchResult).toHaveBeenCalledWith('conversation', 'result');
    await expect(buildMcpExportManifest(source(program), [{ ...task, senderId: 'other' }], 'owner')).rejects.toThrow('result is missing');
    fetchFiles.mockRejectedValueOnce(new Error('Document access revoked'));
    await expect(buildMcpExportManifest(source(program), [task], 'owner')).rejects.toThrow('Document access revoked');
  });
});
