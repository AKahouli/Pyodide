import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { buildMcpExportManifest, buildStructuredExportBlocks } from './document-export';
import { htmlViewExamples } from '../components/openui/html-view-examples';
import { registerHtmlCapture } from '../components/openui/html-capture';
import { dashboardExamples } from '../components/openui/dashboard-examples';
import { registerMiniAppExportGuard, type MiniAppStateIdentity } from '../components/openui/mini-app-state';
import type { Message } from '../types';
import { exportBlocksToHtml } from './html-export';

const fetchState = vi.hoisted(() => vi.fn());
const fetchFiles = vi.hoisted(() => vi.fn());
const fetchResult = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ fetchOpenUiAppState: fetchState, fetchConversationFiles: fetchFiles, fetchMessage: fetchResult }));
vi.mock('./docx-capture', () => ({
  captureSavedHtmlPng: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,aHRtbA==', width: 640, height: 360 })),
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
  it.each(['strict', 'interactive'] as const)('exports an acknowledged %s HTML view to matching local and MCP parts', async mode => {
    const base = mode === 'strict' ? htmlViewExamples.sales : htmlViewExamples.operations;
    const program = mode === 'interactive' ? base.replace('Operations planner</h2>', 'Operations planner</h2><script>window.yellowmind.ready.then(()=>{})</script>') : base;
    const state = mode === 'strict' ? { region: 'North', target: 0, notes: false } : { capacity: 0, label: '' };
    const { identity } = await saved(program, { $view: state });
    const match = program.match(/view = HtmlView\(("(?:[^"\\]|\\.)*")/)!;
    const html = JSON.parse(match[1]) as string;
    const capture = vi.fn(async () => ({ html: '<section><h2>Saved dashboard</h2><p>Capacity 0</p></section>', width: 640, height: 360, text: 'ignored' }));
    const unregister = registerHtmlCapture(identity, { html, name: 'view' }, capture);
    try {
      const blocks = await buildStructuredExportBlocks([source(program)], labels, undefined, undefined, [], 'owner');
      const manifest = await buildMcpExportManifest(source(program), [], 'owner');
      expect(manifest.parts.map(({ componentId: _id, ...part }) => part)).toEqual(blocks[0].parts);
      expect(blocks[0].parts).toContainEqual(expect.objectContaining({ kind: 'image', source: 'data:image/png;base64,aHRtbA==' }));
      expect(blocks[0].markdown).toContain('Capacity 0');
      expect(capture).toHaveBeenCalledWith(state);
      expect(exportBlocksToHtml(blocks, 'Saved HTML').size).toBeGreaterThan(100);
    } finally { unregister(); }
  });
  it('rejects HTML export without an exact live actor/source and rejects a revision changed during capture', async () => {
    const program = htmlViewExamples.sales, state = { region: 'North', target: 0, notes: false };
    const { identity, snapshot } = await saved(program, { $view: state });
    await expect(buildMcpExportManifest(source(program), [], 'owner')).rejects.toThrow('Open the saved HTML view');
    const html = JSON.parse(program.match(/view = HtmlView\(("(?:[^"\\]|\\.)*")/)![1]) as string;
    const foreign = registerHtmlCapture({ ...identity, userId: 'other' }, { html, name: 'view' }, async () => ({ html: '<p>Other user</p>', width: 640, height: 360, text: '' }));
    try { await expect(buildMcpExportManifest(source(program), [], 'owner')).rejects.toThrow('Open the saved HTML view'); } finally { foreign(); }
    const cleanup = registerHtmlCapture(identity, { html, name: 'view' }, async () => {
      fetchState.mockResolvedValue({ ...snapshot, stateRevision: snapshot.stateRevision + 1 });
      return { html: '<p>Saved</p>', width: 640, height: 360, text: '' };
    });
    try { await expect(buildMcpExportManifest(source(program), [], 'owner')).rejects.toThrow('changed during export'); } finally { cleanup(); }
  });
  it('exports two saved HTML dashboards alongside completed agent activity', async () => {
    const program = 'root = Card([sales, operations])\n$salesState = {region:"all",target:0,compare:false}\n$opsState = {status:"all",note:""}\nsales = MiniApp("sales","Sales","Sample",[salesView])\nsalesView = HtmlView("<p>Sales</p>",560,"Sales","sales-view",$salesState)\noperations = MiniApp("operations","Operations","Sample",[opsView])\nopsView = HtmlView("<p>Operations</p>",560,"Operations","ops-view",$opsState)';
    const state = { $salesState: { region: 'all', target: 0, compare: false }, $opsState: { status: 'all', note: '' },
      sales: { 'sales-view': { componentType: 'HtmlView', value: { region: 'North', target: 25, compare: true } } },
      operations: { 'ops-view': { componentType: 'HtmlView', value: { status: 'late', note: 'Saved operations note' } } },
      foreign: { 'sales-view': { componentType: 'HtmlView', value: { region: 'Foreign', target: 999, compare: false } } },
    };
    const { identity } = await saved(program, state);
    const cleanup = [
      registerHtmlCapture(identity, { html: '<p>Sales</p>', name: 'sales-view' }, async value => { expect(value).toEqual(state.sales['sales-view'].value); return { html: '<p>North 25 true</p>', width: 640, height: 360, text: '' }; }),
      registerHtmlCapture(identity, { html: '<p>Operations</p>', name: 'ops-view' }, async value => { expect(value).toEqual(state.operations['ops-view'].value); return { html: '<p>late Saved operations note</p>', width: 640, height: 360, text: '' }; }),
    ];
    const message = source(program);
    message.components!.unshift({ id: 'activity', type: 'agentActivity', data: { status: 'completed', actorName: 'Smart Agent' } });
    try {
      const blocks = await buildStructuredExportBlocks([message], labels, undefined, undefined, [], 'owner');
      expect(blocks[0].parts?.filter(part => part.kind === 'image')).toHaveLength(2);
      expect(blocks[0].markdown).toContain('North 25 true');
      expect(blocks[0].markdown).toContain('late Saved operations note');
      expect((await buildMcpExportManifest(message, [], 'owner')).parts.map(({ componentId: _id, ...part }) => part)).toEqual(blocks[0].parts);
    } finally { cleanup.forEach(unregister => unregister()); }
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
