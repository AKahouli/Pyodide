import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, Server } from 'node:http';
import { McpJwtService } from '@modules/connector/services/mcp-jwt.service';
import { RootDelegateInternalController } from '../controllers/root-delegate-internal.controller';
import { RootWorkService } from './root-work.service';
import { RootDelegateDefinitionService } from './root-delegate-definition.service';
import { RootTemporaryDefinitionService } from './root-temporary-definition.service';
import { RootFanoutService } from './root-fanout.service';
import { RootBackgroundLifecycleService } from './root-background-lifecycle.service';
import { RootBackgroundSubmissionService } from './root-background-submission.service';
import { RootConversationReplyService } from './root-conversation-reply.service';
import { ConversationArtifactService } from '../services/conversation-artifact.service';
import { ROOT_WORK_STORE } from './root-work.store';
import { CONVERSATION_STORE } from '../persistence/conversation-store';
import { PostgresMessageStore } from '../persistence/postgres/postgres-message-store';
import { UserService } from '@modules/user/user.service';
import { RootBackgroundJobStore } from '../persistence/postgres/root-background-job.store';
import { ConversationModule } from '../conversation.module';

describe('Root/native execution authority over real HTTP', () => {
  const actor = '507f1f77bcf86cd799439011', executionId = '507f1f77bcf86cd799439012';
  const conversationId = '507f1f77bcf86cd799439013', messageId = '507f1f77bcf86cd799439014';
  const foreign = '507f1f77bcf86cd799439099';
  const childId = '507f1f77bcf86cd799439015', temporaryId = '507f1f77bcf86cd799439016';
  const machine = 'root-only-machine-test-credential-000000001';
  const conversation = { id: conversationId, createdBy: actor, rootAgentId: 'root', rootWorkEpoch: 1,
    isGroup: false, isArchived: false, members: [], workspaces: ['workspace-1'] };
  const record = { id: executionId, depth: 0, conversationId, conversationEpoch: 1, role: 'root', rootAgentId: 'root', status: 'running',
    resultPayload: { nativeState: { actorId: actor, scope: { executionId, immutableSnapshotRef: 'digest' },
      capabilityCeiling: { workspaceIds: ['workspace-1'] },
      rootContext: { catalog: [{ agent_id: 'worker-B', snapshot_digest: 'worker-digest', configuration_mode: 'native' }] } } } };
  const child = { ...record, id: childId, role: 'library_worker', depth: 1, parentExecutionId: executionId,
    resultPayload: { nativeState: { actorId: actor, scope: { executionId: childId, parentExecutionId: executionId,
      immutableSnapshotRef: 'worker-digest' }, admittedRequest: { agentId: 'worker-B' },
      rootContext: { selected_agent_id: 'worker-B', source_workspace_ids: ['workspace-B'] } } } };
  const temporary = { ...record, id: temporaryId, role: 'temporary_worker', depth: 1, parentExecutionId: executionId,
    resultPayload: { nativeState: { actorId: actor, scope: { executionId: temporaryId, parentExecutionId: executionId,
      immutableSnapshotRef: 'digest' }, admittedRequest: { contextRefs: ['workspace-1'] },
       rootContext: { selected_agent_id: temporaryId, origin_root_agent_id: 'root', source_workspace_ids: ['workspace-1'] } } } };
  const message = { id: messageId, conversationId, conversationType: 'ai', isStreaming: true, isComplete: false,
    streamExecutionLeaseId: 'lease-generation-1', streamExecutionLeaseExpiresAt: new Date(Date.now() + 3600000) };
  const store = { getExecution: jest.fn() }, conversations = { findById: jest.fn() }, messages = { findById: jest.fn() };
  const users = { findById: jest.fn() }, jobs = { getJob: jest.fn() }, resolver = { resolveForActor: jest.fn() };
  const artifacts = { listAssets: jest.fn() };
  const resolve = jest.fn();
  const resolveTemporary = jest.fn();
  let work: RootWorkService, signer: McpJwtService, app: INestApplication, directory: string;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ws01-root-'));
    const path = join(directory, 'ephemeral.pem');
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    writeFileSync(path, key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const values: Record<string, unknown> = { NODE_ENV: 'production', MCP_JWT_PRIVATE_KEY_FILE: path,
      MCP_JWT_ISSUER: 'root-test', ADK_ROOT_RUNTIME_SERVICE_TOKEN: machine };
    const config = { get: (name: string, fallback?: unknown) => values[name] ?? fallback } as ConfigService;
    signer = new McpJwtService(config, users as never, {} as never, {} as never);
    work = new RootWorkService(store as never, signer, conversations as never, messages as never, users as never, jobs as never);
    const definitions = new RootDelegateDefinitionService(work, { getConversationDocument: conversations.findById } as never, resolver as never,
      {} as never, {} as never, {} as never, jobs as never, {} as never);
    definitions.resolve = resolve;
    const module = await Test.createTestingModule({ controllers: [RootDelegateInternalController], providers: [
      { provide: ConfigService, useValue: config }, { provide: RootWorkService, useValue: work },
      { provide: RootDelegateDefinitionService, useValue: definitions },
      { provide: RootTemporaryDefinitionService, useValue: { resolve: resolveTemporary } },
      ...[RootFanoutService, RootBackgroundLifecycleService,
        RootBackgroundSubmissionService, RootConversationReplyService].map(provide => ({ provide, useValue: {} })),
      { provide: ConversationArtifactService, useValue: artifacts },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { if (app) await app.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  beforeEach(() => {
    jest.clearAllMocks();
    store.getExecution.mockImplementation(async id => id === executionId ? record : id === childId ? child : id === temporaryId ? temporary : null);
    conversations.findById.mockResolvedValue(conversation);
    messages.findById.mockResolvedValue(message); users.findById.mockResolvedValue({ id: actor, status: 'active' });
    resolver.resolveForActor.mockResolvedValue({ rootSnapshotDigest: 'digest', delegationEnabled: true,
      entries: [{ agentId: 'worker-B', snapshotDigest: 'worker-digest', configurationMode: 'native' }],
      policy: { temporaryWorkers: { enabled: true } } });
    artifacts.listAssets.mockResolvedValue({ assets: [] }); resolve.mockResolvedValue({ executionId: childId, definition: { id: 'worker-B' } });
    resolveTemporary.mockResolvedValue({ executionId: temporaryId, definition: { id: temporaryId } });
    jobs.getJob.mockImplementation(async id => id === executionId ? { executionId, parentExecutionId: undefined, actorId: actor, conversationId,
      conversationEpoch: 1, status: 'running', owner: 'scheduler', fence: 2,
      leaseUntil: new Date(Date.now() + 60000), deadline: new Date(Date.now() + 3600000) } : null);
  });
  const proof = () => work.issueForegroundAuthority(executionId, actor, conversationId, messageId, message.streamExecutionLeaseId);
  const post = async (route: string, token?: string, body: object = {}, extra: Record<string, string | string[]> = {}) => {
    const address = (app.getHttpServer() as Server).address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const payload = Buffer.from(JSON.stringify(body));
    return new Promise<{ status: number; body: Record<string, unknown>; childProof?: string }>((accept, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port: address.port, method: 'POST',
        path: `/internal/root-work/${route}`, headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length,
          'X-YellowStorm-Service-Principal': 'adk-root-runtime', 'X-YellowStorm-Service-Token': machine,
          ...(token ? { 'X-YellowStorm-Execution-Authority': token } : {}), ...extra } }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
        response.on('end', () => accept({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()),
          childProof: typeof response.headers['x-yellowstorm-child-authority'] === 'string' ? response.headers['x-yellowstorm-child-authority'] : undefined }));
      }); request.on('error', reject); request.end(payload);
    });
  };
  it('accepts admitted Root delegate/assets calls and renews within the exact live attempt', async () => {
    const token = await proof();
    expect((await post(`${executionId}/delegate-definition`, token)).status).toBe(201);
    expect((await post('assets/list', token, { userId: actor, conversationId, workspaceId: 'workspace-1' })).status).toBe(201);
    const renewed = await post(`${executionId}/authority/renew`, token);
    expect(renewed.status).toBe(201);
    expect(signer.verifyAdkExecutionAuthority(String(renewed.body.token), 'root-work').generation).toBe(message.streamExecutionLeaseId);
  });
  it('resolves the production authority injection tokens and exported authorizer without connecting to stores', async () => {
    const module = await Test.createTestingModule({ providers: [RootWorkService,
      { provide: ROOT_WORK_STORE, useValue: store }, { provide: CONVERSATION_STORE, useValue: conversations },
      { provide: PostgresMessageStore, useValue: messages }, { provide: UserService, useValue: users },
      { provide: RootBackgroundJobStore, useValue: jobs }, { provide: McpJwtService, useValue: signer },
    ] }).compile();
    try {
      const injected = module.get(RootWorkService);
      const token = await injected.issueForegroundAuthority(executionId, actor, conversationId, messageId, message.streamExecutionLeaseId);
      expect(await injected.assertRootAuthority(token)).toMatchObject({ sub: actor, executionId, conversationId });
      expect(Reflect.getMetadata('exports', ConversationModule)).toContain(RootWorkService);
    } finally { await module.close(); }
  });
  it.each(['library', 'temporary'])('transports %s foreground child authority only in headers, bound to the parent stream generation', async role => {
    const parentProof = await proof();
    const id = role === 'library' ? childId : temporaryId;
    const admitted = await post(`${executionId}/${role === 'library' ? 'delegate-definition' : 'temporary-definition'}`, parentProof);
    expect(admitted.status).toBe(201);
    expect(admitted.childProof).toBeTruthy();
    expect(JSON.stringify(admitted.body)).not.toContain(admitted.childProof);
    expect(signer.verifyAdkExecutionAuthority(admitted.childProof, 'root-work')).toMatchObject({ executionId: id,
      parentExecutionId: executionId, messageId, generation: message.streamExecutionLeaseId, sub: actor, conversationId });
    const workspaceId = role === 'library' ? 'workspace-B' : 'workspace-1';
    expect((await post('assets/list', admitted.childProof, { userId: actor, conversationId, workspaceId })).status).toBe(201);
    if (role === 'library') expect((await post('assets/list', parentProof, { userId: actor, conversationId, workspaceId })).status).toBe(401);
    expect((await post(`${id}/authority/renew`, admitted.childProof)).status).toBe(201);
    expect((await post(`${id}/delegate-definition`, admitted.childProof)).status).toBe(401);
    expect((await post(`${executionId}/authority/renew`, parentProof)).status).toBe(201);
  });
  it.each(['parent cancelled', 'child cancelled', 'lease reclaimed', 'lease expired', 'selected revoked', 'root revision', 'foreign binding', 'background job'])
  ('rejects foreground child operation and refresh after %s', async scenario => {
    const parentProof = await proof();
    const admitted = await post(`${executionId}/delegate-definition`, parentProof);
    expect(admitted.status).toBe(201);
    if (scenario === 'parent cancelled') store.getExecution.mockImplementation(async id => id === executionId ? { ...record, status: 'cancelled' } : child);
    if (scenario === 'child cancelled') store.getExecution.mockImplementation(async id => id === childId ? { ...child, status: 'cancelled' } : record);
    if (scenario === 'lease reclaimed') messages.findById.mockResolvedValue({ ...message, streamExecutionLeaseId: 'reclaimed' });
    if (scenario === 'lease expired') messages.findById.mockResolvedValue({ ...message, streamExecutionLeaseExpiresAt: new Date(0) });
    if (scenario === 'selected revoked') resolver.resolveForActor.mockResolvedValue({ rootSnapshotDigest: 'digest', delegationEnabled: true, entries: [] });
    if (scenario === 'root revision') resolver.resolveForActor.mockResolvedValue({ rootSnapshotDigest: 'different-root', entries: [] });
    if (scenario === 'foreign binding') store.getExecution.mockImplementation(async id => id === childId ? { ...child, parentExecutionId: foreign } : record);
    if (scenario === 'background job') jobs.getJob.mockResolvedValue({ owner: 'scheduler', fence: 1 });
    expect((await post('assets/list', admitted.childProof, { userId: actor, conversationId, workspaceId: 'workspace-B' })).status).toBeGreaterThanOrEqual(400);
    expect((await post(`${childId}/authority/renew`, admitted.childProof)).status).toBeGreaterThanOrEqual(400);
  });
  it('cannot mint a child proof from a naked selector, a foreign child, or another child proof', async () => {
    const parentProof = await proof();
    await expect(work.issueForegroundChildAuthority(undefined, childId)).rejects.toThrow();
    await expect(work.issueForegroundChildAuthority(parentProof, foreign)).rejects.toThrow();
    const token = await work.issueForegroundChildAuthority(parentProof, childId);
    await expect(work.issueForegroundChildAuthority(token, temporaryId)).rejects.toThrow();
    await expect(work.issueForegroundAuthority(childId, actor, conversationId, messageId, message.streamExecutionLeaseId)).rejects.toThrow();
  });
  it('rejects expired child proof even while the parent lease remains live', async () => {
    const parentProof = await proof();
    const token = await work.issueForegroundChildAuthority(parentProof, childId);
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 301_000);
    try {
      expect((await post('assets/list', token, { userId: actor, conversationId, workspaceId: 'workspace-B' })).status).toBe(401);
      expect((await post(`${childId}/authority/renew`, token)).status).toBe(401);
    } finally { clock.mockRestore(); }
  });
  it.each(['userId', 'actorId', 'ownerId', 'conversationId', 'workspaceId'])('rejects foreign asset selector %s', async name => {
    const token = await proof();
    expect((await post('assets/list', token, { userId: actor, conversationId, [name]: foreign })).status).toBe(401);
    expect(artifacts.listAssets).not.toHaveBeenCalled();
  });
  it.each(['missing', 'foreign execution', 'generic key', 'duplicate', 'artifact purpose'])('rejects %s without domain work', async scenario => {
    let token: string | undefined = await proof();
    const extra: Record<string, string | string[]> = {};
    if (scenario === 'missing') token = undefined;
    if (scenario === 'generic key') extra['X-YellowStorm-Service-Token'] = 'generic';
    if (scenario === 'duplicate') extra['X-YellowStorm-Execution-Authority'] = [token!, token!];
    if (scenario === 'artifact purpose') token = signer.issueAdkExecutionAuthority({ ...signer.verifyAdkExecutionAuthority(token, 'root-work'), purpose: 'playbook-artifact' });
    expect((await post(`${scenario === 'foreign execution' ? foreign : executionId}/delegate-definition`, token, {}, extra)).status).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each(['cancelled', 'epoch', 'owner', 'lease expired', 'lease reclaimed', 'account revoked', 'definition revoked'])('rechecks %s on operation and refresh', async scenario => {
    const token = await proof();
    if (scenario === 'cancelled') store.getExecution.mockResolvedValue({ ...record, status: 'cancellation_requested' });
    if (scenario === 'epoch') conversations.findById.mockResolvedValue({ ...conversation, rootWorkEpoch: 2 });
    if (scenario === 'owner') conversations.findById.mockResolvedValue({ ...conversation, createdBy: foreign });
    if (scenario === 'lease expired') messages.findById.mockResolvedValue({ ...message, streamExecutionLeaseExpiresAt: new Date(0) });
    if (scenario === 'lease reclaimed') messages.findById.mockResolvedValue({ ...message, streamExecutionLeaseId: 'new-generation' });
    if (scenario === 'account revoked') users.findById.mockResolvedValue({ status: 'suspended' });
    if (scenario === 'definition revoked') resolver.resolveForActor.mockRejectedValue(new Error('revoked'));
    expect((await post('assets/list', token, { userId: actor, conversationId })).status).toBeGreaterThanOrEqual(400);
    expect((await post(`${executionId}/authority/renew`, token)).status).toBeGreaterThanOrEqual(400);
    expect(artifacts.listAssets).not.toHaveBeenCalled();
  });
  it('preserves normal non-root conversation assets without granting Root controls', async () => {
    const token = await work.issueNativeConversationAuthority(actor, conversationId, messageId, message.streamExecutionLeaseId);
    expect((await post('assets/list', token, { userId: actor, conversationId })).status).toBe(201);
    expect((await post(`${executionId}/delegate-definition`, token)).status).toBe(401);
    expect((await post('native-authority/renew', token)).status).toBe(201);
    messages.findById.mockResolvedValue({ ...message, isComplete: true });
    expect((await post('native-authority/renew', token)).status).toBe(401);
  });
  it('binds background proof to the exact canonical scheduler generation', async () => {
    const job = await jobs.getJob(executionId);
    const token = await work.issueBackgroundAuthority(job);
    expect((await post(`${executionId}/authority/renew`, token, { owner: 'scheduler', fence: 2 })).status).toBe(201);
    expect((await post(`${executionId}/authority/renew`, token, { owner: 'foreign', fence: 2 })).status).toBe(401);
    jobs.getJob.mockResolvedValue({ ...job, fence: 3 });
    expect((await post(`${executionId}/authority/renew`, token)).status).toBe(401);
  });
});
