import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, Server } from 'node:http';
import { McpJwtService } from '@modules/connector/services/mcp-jwt.service';
import { ConnectorInternalController } from '@modules/connector/controllers/connector-internal.controller';
import { ConnectorTransferService } from '@modules/connector/connector-transfer.service';
import { ConnectorService } from '@modules/connector/connector.service';
import { RootWorkService } from '@modules/conversation/root-work/root-work.service';
import { RootDelegateDefinitionService } from '@modules/conversation/root-work/root-delegate-definition.service';
import { PlaybookFlowArtifactService } from '@modules/playbook-flow/services/playbook-flow-artifact.service';
import { ExecutionRepository } from '@modules/playbook-flow/persistence/execution.repository';
import { Permissions } from '@modules/authorization/constants/permissions';
import { WorkspaceIngestController } from '@modules/workspace/workspace-ingest.controller';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { PgWorkspaceStore } from '@modules/workspace/stores/postgres/pg-workspace-store';
import { TelegramValidationInternalController } from '@modules/telegram/controllers/telegram-validation-internal.controller';
import { TelegramValidationService } from '@modules/telegram/services/telegram-validation.service';

// Real production routes, principal guards, RSA verification and canonical
// authorizers. Only persistence/current-rights reads and external side effects
// are replaced; no application database or outbound provider is contacted.
describe('ADK native tool authority over HTTP', () => {
  const actor = '507f1f77bcf86cd799439011', conversationId = '507f1f77bcf86cd799439012';
  const messageId = '507f1f77bcf86cd799439013', executionId = '507f1f77bcf86cd799439014';
  const workspaceId = '507f1f77bcf86cd799439015', foreign = '507f1f77bcf86cd799439099';
  const rootKey = 'root-native-test-machine-credential-000000001';
  const playbookKey = 'playbook-native-test-machine-credential-0001';
  const conversation = { id: conversationId, createdBy: actor, isArchived: false, isGroup: false,
    rootAgentId: 'root-agent', rootWorkEpoch: 1, members: [], workspaces: [workspaceId] };
  const rootExecution = { id: executionId, conversationId, conversationEpoch: 1, role: 'root', depth: 0,
    rootAgentId: 'root-agent', status: 'running', resultPayload: { nativeState: { actorId: actor,
      scope: { executionId, immutableSnapshotRef: 'root-digest' }, capabilityCeiling: { workspaceIds: [workspaceId] },
      rootContext: { catalog: [{ agent_id: 'worker-agent', snapshot_digest: 'worker-digest', configuration_mode: 'native' }] } } } };
  const message = { id: messageId, conversationId, conversationType: 'ai', isStreaming: true, isComplete: false,
    streamExecutionLeaseId: 'native-generation', streamExecutionLeaseExpiresAt: new Date(Date.now() + 3600000) };
  const execution = { id: executionId, ownerId: actor, flowId: 'flow', status: 'running',
    startedAt: new Date('2026-10-18T12:00:00Z'), snapshot: { workspaces: [workspaceId] } };
  const conversations = { findById: jest.fn(), getConversationDocument: jest.fn() }, messages = { findById: jest.fn() }, users = { findById: jest.fn() };
  const rootStore = { getExecution: jest.fn() }, rootResolver = { resolveForActor: jest.fn() };
  const rootJobs = { getJob: jest.fn() };
  const executions = { findOwned: jest.fn() }, leases = { authorityGeneration: jest.fn() };
  const access = { assertExecutionAccess: jest.fn() };
  const authorization = { getUserRoles: jest.fn(), getUserPermissions: jest.fn() };
  const transfer = { importToWorkspace: jest.fn() }, documents = { ingestFromUrl: jest.fn() };
  const workspaces = { findById: jest.fn() }, validations = { create: jest.fn() };
  let signer: McpJwtService, root: RootWorkService, artifacts: PlaybookFlowArtifactService;
  let app: INestApplication, directory: string;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ws01-native-'));
    const path = join(directory, 'ephemeral.pem');
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    writeFileSync(path, key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const values: Record<string, unknown> = { NODE_ENV: 'production', MCP_JWT_PRIVATE_KEY_FILE: path,
      MCP_JWT_ISSUER: 'native-test', ADK_ROOT_RUNTIME_SERVICE_TOKEN: rootKey,
      ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN: playbookKey };
    const config = { get: (name: string, fallback?: unknown) => values[name] ?? fallback } as ConfigService;
    signer = new McpJwtService(config, users as never, authorization as never, {} as never);
    root = new RootWorkService(rootStore as never, signer, conversations as never, messages as never, users as never, rootJobs as never);
    const definitions = new RootDelegateDefinitionService(root, conversations as never, rootResolver as never,
      {} as never, {} as never, {} as never, {} as never, {} as never);
    artifacts = new PlaybookFlowArtifactService(executions as never, {} as never, access as never,
      {} as never, new JwtService(), config, {} as never, signer, leases as never, users as never, authorization as never);
    const module = await Test.createTestingModule({
      controllers: [WorkspaceIngestController, ConnectorInternalController, TelegramValidationInternalController],
      providers: [
        { provide: ConfigService, useValue: config }, { provide: McpJwtService, useValue: signer },
        { provide: RootWorkService, useValue: root }, { provide: RootDelegateDefinitionService, useValue: definitions },
        { provide: PlaybookFlowArtifactService, useValue: artifacts }, { provide: ExecutionRepository, useValue: executions },
        { provide: ConnectorTransferService, useValue: transfer }, { provide: ConnectorService, useValue: {} },
        { provide: WorkspaceDocumentService, useValue: documents }, { provide: PgWorkspaceStore, useValue: workspaces },
        { provide: TelegramValidationService, useValue: validations },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { if (app) await app.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  beforeEach(() => {
    jest.clearAllMocks();
    conversations.findById.mockResolvedValue(conversation); messages.findById.mockResolvedValue(message);
    conversations.getConversationDocument.mockResolvedValue(conversation);
    rootStore.getExecution.mockResolvedValue(rootExecution); rootResolver.resolveForActor.mockResolvedValue({ rootSnapshotDigest: 'root-digest' });
    users.findById.mockResolvedValue({ id: actor, status: 'active' });
    executions.findOwned.mockResolvedValue(execution); leases.authorityGeneration.mockResolvedValue('playbook-generation');
    authorization.getUserRoles.mockResolvedValue([{ id: 'role' }]);
    authorization.getUserPermissions.mockResolvedValue([Permissions.PLAYBOOK_EXECUTE]);
    access.assertExecutionAccess.mockResolvedValue(undefined);
    workspaces.findById.mockImplementation(async (id: string) => ({ id, createdBy: actor }));
    documents.ingestFromUrl.mockResolvedValue({ id: 'document' }); transfer.importToWorkspace.mockResolvedValue({ success: true });
    validations.create.mockResolvedValue({ validationId: 'validation' });
  });
  const nativeProof = () => root.issueNativeConversationAuthority(actor, conversationId, messageId, message.streamExecutionLeaseId);
  const childProof = async ({ sources = [workspaceId], mode = 'native', scenario = '', transport = 'background',
    role = 'library_worker', ceiling = [workspaceId] }:
    { sources?: string[]; mode?: 'native' | 'root_constrained'; scenario?: string; transport?: 'foreground' | 'background';
      role?: 'library_worker' | 'temporary_worker'; ceiling?: string[] } = {}) => {
    const childId = '507f1f77bcf86cd799439017';
    const child = { ...rootExecution, id: childId, role, depth: 1, parentExecutionId: executionId,
      resultPayload: { nativeState: { actorId: actor, scope: { executionId: childId, parentExecutionId: executionId,
        immutableSnapshotRef: role === 'temporary_worker' ? 'root-digest' : 'worker-digest' },
        admittedRequest: role === 'temporary_worker' ? { contextRefs: sources } : { agentId: 'worker-agent' },
        rootContext: { selected_agent_id: role === 'temporary_worker' ? childId : 'worker-agent',
          origin_root_agent_id: 'root-agent', source_workspace_ids: sources } } } };
    const parent = { ...rootExecution, status: transport === 'foreground' ? 'running' : 'completed', resultPayload: { nativeState: {
      ...rootExecution.resultPayload.nativeState, capabilityCeiling: { workspaceIds: ceiling }, rootContext: { catalog: [{ agent_id: 'worker-agent',
        snapshot_digest: 'worker-digest', configuration_mode: mode }] } } } };
    rootStore.getExecution.mockImplementation(async (id: string) => id === childId ? child : parent);
    rootResolver.resolveForActor.mockResolvedValue({ delegationEnabled: true,
      policy: { temporaryWorkers: { enabled: true }, fanout: { enabled: true } },
      rootSnapshotDigest: scenario === 'root changed' ? 'new-root-digest' : 'root-digest',
      entries: scenario === 'worker revoked' ? [] : [{ agentId: 'worker-agent',
        snapshotDigest: scenario === 'worker changed' ? 'new-worker-digest' : 'worker-digest', configurationMode: mode }] });
    if (transport === 'foreground') {
      rootJobs.getJob.mockResolvedValue(null);
      const parentToken = await root.issueForegroundAuthority(executionId, actor, conversationId, messageId, message.streamExecutionLeaseId);
      return root.issueForegroundChildAuthority(parentToken, childId);
    }
    const job = { executionId: childId, parentExecutionId: executionId, actorId: actor, conversationId,
      conversationEpoch: 1, status: 'running', owner: 'scheduler', fence: 2,
      leaseUntil: new Date(Date.now() + 60000), deadline: new Date(Date.now() + 3600000) };
    rootJobs.getJob.mockResolvedValue(job);
    return root.issueBackgroundAuthority(job as never);
  };
  const ingest = { userId: actor, downloadUrl: 'https://example.com/file', filename: 'file.txt' };
  const importBody = { userId: actor, connectorId: '507f1f77bcf86cd799439016', workspaceId, mode: 'file', itemRef: { id: 'file' } };
  const importPath = '/connectors/internal/transfer/import';
  const post = async (path: string, body: object, token?: string, extra: Record<string, string | string[]> = {}) => {
    const address = (app.getHttpServer() as Server).address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const payload = Buffer.from(JSON.stringify(body));
    return new Promise<number>((accept, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port: address.port, method: 'POST', path,
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length,
          'X-YellowStorm-Service-Principal': 'adk-root-runtime', 'X-YellowStorm-Service-Token': rootKey,
          ...(token ? { 'X-YellowStorm-Execution-Authority': token } : {}), ...extra } }, response => {
        response.resume(); response.on('end', () => accept(response.statusCode!)); response.on('error', reject);
      }); request.on('error', reject); request.end(payload);
    });
  };
  it('uses the verified native actor for ingest, transfer and exact-conversation validation', async () => {
    const token = await nativeProof();
    expect(await post(`/workspaces/${workspaceId}/documents/ingest-url`, ingest, token)).toBe(201);
    expect(await post(importPath, importBody, token)).toBe(201);
    expect(await post('/telegram/internal/validations', { integration_id: foreign, conversation_id: conversationId, question: 'q' }, token)).toBe(201);
    expect(documents.ingestFromUrl).toHaveBeenCalledWith(workspaceId, expect.objectContaining({ userId: actor }));
    expect(transfer.importToWorkspace).toHaveBeenCalledWith(actor, importBody.connectorId, workspaceId, expect.any(Object));
    expect(validations.create).toHaveBeenCalledWith(expect.objectContaining({ conversation_id: conversationId }), actor);
  });
  it.each(['missing proof', 'generic key', 'foreign principal', 'duplicate proof', 'foreign actor', 'foreign workspace'])
    ('denies %s before transfer side effects', async scenario => {
      let token: string | undefined = await nativeProof();
      const body = { ...importBody }, headers: Record<string, string | string[]> = {};
      if (scenario === 'missing proof') token = undefined;
      if (scenario === 'generic key') headers['X-YellowStorm-Service-Token'] = 'legacy-generic-key';
      if (scenario === 'foreign principal') headers['X-YellowStorm-Service-Principal'] = 'mcp-agent';
      if (scenario === 'duplicate proof') headers['X-YellowStorm-Execution-Authority'] = [token!, token!];
      if (scenario === 'foreign actor') body.userId = foreign;
      if (scenario === 'foreign workspace') body.workspaceId = foreign;
      expect(await post(importPath, body, token, headers)).toBe(401);
      expect(transfer.importToWorkspace).not.toHaveBeenCalled();
    });
  it.each(['reclaimed lease', 'completed message', 'revoked account', 'revoked membership'])('rechecks %s on each native call', async scenario => {
    const token = await nativeProof();
    if (scenario === 'reclaimed lease') messages.findById.mockResolvedValue({ ...message, streamExecutionLeaseId: 'replacement' });
    if (scenario === 'completed message') messages.findById.mockResolvedValue({ ...message, isComplete: true });
    if (scenario === 'revoked account') users.findById.mockResolvedValue({ status: 'suspended' });
    if (scenario === 'revoked membership') conversations.findById.mockResolvedValue({ ...conversation, createdBy: foreign });
    expect(await post(importPath, importBody, token)).toBeGreaterThanOrEqual(400);
    expect(transfer.importToWorkspace).not.toHaveBeenCalled();
  });
  it('does not accept a same-owner foreign conversation for Telegram', async () => {
    expect(await post('/telegram/internal/validations', { integration_id: foreign, conversation_id: foreign, question: 'q' }, await nativeProof())).toBe(401);
    expect(validations.create).not.toHaveBeenCalled();
  });
  it('preserves Playbook native transfer only inside its current live attempt and snapshot workspace', async () => {
    const token = await artifacts.issuePublicationAuthority(executionId, actor);
    const headers = { 'X-YellowStorm-Service-Principal': 'adk-playbook-artifact', 'X-YellowStorm-Service-Token': playbookKey };
    expect(await post(importPath, importBody, token, headers)).toBe(201);
    transfer.importToWorkspace.mockClear();
    expect(await post(importPath, { ...importBody, workspaceId: foreign }, token, headers)).toBe(401);
    expect(transfer.importToWorkspace).not.toHaveBeenCalled();
    leases.authorityGeneration.mockResolvedValue('replacement-generation');
    expect(await post(importPath, importBody, token, headers)).toBe(401);
  });
  it('rejects cross-purpose proof even with a valid machine credential', async () => {
    const token = await artifacts.issuePublicationAuthority(executionId, actor);
    expect(await post(importPath, importBody, token)).toBe(401);
    expect(transfer.importToWorkspace).not.toHaveBeenCalled();
  });
  it('accepts a live Root dispatch with its current definition authorization', async () => {
    const token = await root.issueForegroundAuthority(executionId, actor, conversationId, messageId, message.streamExecutionLeaseId);
    expect(await post(importPath, importBody, token)).toBe(201);
    expect(rootResolver.resolveForActor).toHaveBeenCalledWith('root-agent', actor, conversationId, null);
  });
  it('rechecks current Root definition revocation before native side effects', async () => {
    const token = await root.issueForegroundAuthority(executionId, actor, conversationId, messageId, message.streamExecutionLeaseId);
    rootResolver.resolveForActor.mockResolvedValue({ rootSnapshotDigest: 'changed-root-digest' });
    expect(await post(importPath, importBody, token)).toBe(403);
    expect(transfer.importToWorkspace).not.toHaveBeenCalled();
  });
  it.each(['valid child', 'worker revoked', 'worker changed', 'root changed'])
    ('checks distinct worker/root definitions for a delegated library job: %s', async scenario => {
      const token = await childProof({ scenario });
      expect(await post(importPath, importBody, token)).toBe(scenario === 'valid child' ? 201 : 403);
      if (scenario !== 'valid child') expect(transfer.importToWorkspace).not.toHaveBeenCalled();
    });
  it.each((['background', 'foreground'] as const).flatMap(transport =>
    ['native source', 'unadmitted source', 'constrained ceiling', 'owner revoked'].map(scenario => ({ transport, scenario }))))
    ('checks a selected worker workspace outside the conversation: $transport / $scenario', async ({ transport, scenario }) => {
      const workerWorkspace = '507f1f77bcf86cd799439018';
      const token = await childProof({ sources: [workerWorkspace],
        mode: scenario === 'constrained ceiling' ? 'root_constrained' : 'native', transport });
      const target = scenario === 'unadmitted source' ? foreign : workerWorkspace;
      if (scenario === 'owner revoked') workspaces.findById.mockResolvedValue({ id: target, createdBy: foreign });
      const status = await post(`/workspaces/${target}/documents/ingest-url`, ingest, token);
      expect(status).toBe(scenario === 'native source' ? 201 : scenario === 'owner revoked' ? 403 : 401);
      if (scenario === 'native source') {
        expect(documents.ingestFromUrl).toHaveBeenCalledWith(workerWorkspace, expect.objectContaining({ userId: actor }));
        expect(await post(importPath, { ...importBody, workspaceId: workerWorkspace }, token)).toBe(201);
      } else expect(documents.ingestFromUrl).not.toHaveBeenCalled();
    });
  it.each(['worker revoked', 'parent lease reclaimed', 'parent completed', 'child cancelled'])
    ('rechecks live foreground child authority without a scheduler job: %s', async scenario => {
      const workerWorkspace = '507f1f77bcf86cd799439018';
      const token = await childProof({ sources: [workerWorkspace], transport: 'foreground' });
      if (scenario === 'worker revoked') rootResolver.resolveForActor.mockResolvedValue({
        delegationEnabled: true, rootSnapshotDigest: 'root-digest', entries: [] });
      if (scenario === 'parent lease reclaimed') messages.findById.mockResolvedValue({ ...message, streamExecutionLeaseId: 'replacement' });
      if (scenario === 'parent completed' || scenario === 'child cancelled') {
        const read = rootStore.getExecution.getMockImplementation()!;
        rootStore.getExecution.mockImplementation(async (id: string) => {
          const row = await read(id);
          return id === executionId && scenario === 'parent completed' ? { ...row, status: 'completed' }
            : id !== executionId && scenario === 'child cancelled' ? { ...row, status: 'cancelled' } : row;
        });
      }
      expect(await post(importPath, { ...importBody, workspaceId: workerWorkspace }, token))
        .toBe(scenario === 'worker revoked' ? 403 : 401);
      expect(transfer.importToWorkspace).not.toHaveBeenCalled();
    });
  it.each(['admitted source', 'unadmitted source', 'owner revoked'])
    ('checks a foreground temporary worker source outside conversation links: %s', async scenario => {
      const workerWorkspace = '507f1f77bcf86cd799439018';
      const token = await childProof({ role: 'temporary_worker', sources: [workerWorkspace],
        ceiling: [workerWorkspace, foreign], transport: 'foreground' });
      const target = scenario === 'unadmitted source' ? foreign : workerWorkspace;
      if (scenario === 'owner revoked') workspaces.findById.mockResolvedValue({ id: target, createdBy: foreign });
      expect(await post(`/workspaces/${target}/documents/ingest-url`, ingest, token))
        .toBe(scenario === 'admitted source' ? 201 : scenario === 'owner revoked' ? 403 : 401);
      if (scenario === 'admitted source') {
        expect(await post(importPath, { ...importBody, workspaceId: workerWorkspace }, token)).toBe(201);
      } else expect(documents.ingestFromUrl).not.toHaveBeenCalled();
    });
  it('preserves a Root definition workspace admitted outside the conversation links', async () => {
    const rootWorkspace = '507f1f77bcf86cd799439018';
    rootStore.getExecution.mockResolvedValue({ ...rootExecution, resultPayload: { nativeState: {
      ...rootExecution.resultPayload.nativeState, capabilityCeiling: { workspaceIds: [rootWorkspace] } } } });
    const token = await root.issueForegroundAuthority(executionId, actor, conversationId, messageId, message.streamExecutionLeaseId);
    expect(await post(`/workspaces/${rootWorkspace}/documents/ingest-url`, ingest, token)).toBe(201);
  });
});
