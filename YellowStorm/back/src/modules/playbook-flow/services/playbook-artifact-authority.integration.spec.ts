import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, Server } from 'node:http';
import { sign } from 'jsonwebtoken';
import { PlaybookFlowInternalArtifactController } from '../controllers/playbook-flow-internal-artifact.controller';
import { PlaybookFlowArtifactService } from './playbook-flow-artifact.service';
import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { McpJwtService } from '@modules/connector/services/mcp-jwt.service';
import { ExecutionLeaseRepository } from '../persistence/execution-lease.repository';

describe('ADK artifact dispatch / publication authority boundary', () => {
  const executionId = '507f1f77bcf86cd799439011', ownerId = '507f1f77bcf86cd799439012', flowId = '507f1f77bcf86cd799439013';
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const machineToken = 'artifact-machine-test-credential-0000000001';
  const execution = { id: executionId, ownerId, flowId, status: 'running', startedAt: new Date('2026-10-18T10:00:00Z') };
  const executions = { findOwned: jest.fn() };
  const leases = { authorityGeneration: jest.fn() };
  const users = { findById: jest.fn() };
  const authorization = { getUserRoles: jest.fn(), getUserPermissions: jest.fn() };
  const access = { assertExecutionAccess: jest.fn() };
  const documents = { isAvailable: () => true, exists: jest.fn(), upload: jest.fn() };
  let signer: McpJwtService, service: PlaybookFlowArtifactService, app: INestApplication;
  let config: ConfigService, directory: string;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ws01-artifact-'));
    const keyPath = join(directory, 'ephemeral.pem');
    writeFileSync(keyPath, key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const values: Record<string, unknown> = { MCP_JWT_PRIVATE_KEY_FILE: keyPath, MCP_JWT_ISSUER: 'artifact-test',
      NODE_ENV: 'production', ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN: machineToken };
    config = { get: (name: string, fallback?: unknown) => values[name] ?? fallback } as ConfigService;
    signer = new McpJwtService(config, users as never, {} as never, authorization as never);
    service = new PlaybookFlowArtifactService(executions as never, {} as never, access as never, documents as never,
      {} as never, config, {} as never, signer, leases as never, users as never, authorization as never);
    const module = await Test.createTestingModule({ controllers: [PlaybookFlowInternalArtifactController],
      providers: [{ provide: PlaybookFlowArtifactService, useValue: service }, { provide: ConfigService, useValue: config }] }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { if (app) await app.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  beforeEach(() => {
    jest.clearAllMocks();
    executions.findOwned.mockImplementation(async (id, owner) => id === executionId && owner === ownerId ? { ...execution } : null);
    leases.authorityGeneration.mockResolvedValue('lease-acquisition-1');
    users.findById.mockResolvedValue({ id: ownerId, status: 'active' });
    authorization.getUserRoles.mockResolvedValue([{ id: 'role' }]);
    authorization.getUserPermissions.mockResolvedValue(['playbook.execute']);
    access.assertExecutionAccess.mockResolvedValue(undefined);
    documents.exists.mockResolvedValue(true);
    documents.upload.mockImplementation(async (buffer: Buffer, name: string, mime: string, options: { folder: string; customFileName: string }) =>
      ({ blobPath: `${options.folder}/${options.customFileName}`, originalName: name, mimeType: mime, size: buffer.length }));
  });
  const post = async (suffix: string, token?: string, extra: Record<string, string | string[]> = {}) => {
    const address = (app.getHttpServer() as Server).address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const boundary = 'ws01-test-boundary';
    const body = suffix ? Buffer.alloc(0) : Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="report.pdf"\r\nContent-Type: application/pdf\r\n\r\npdf\r\n--${boundary}--\r\n`);
    return new Promise<{ status: number; body: Record<string, string> }>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: address.port, method: 'POST',
        path: `/internal/playbook-artifacts/executions/${executionId}${suffix}`, headers: {
          'X-YellowStorm-Service-Principal': 'adk-playbook-artifact', 'X-YellowStorm-Service-Token': machineToken,
          'X-YellowStorm-User-Id': ownerId, ...(token ? { 'X-YellowStorm-Execution-Authority': token } : {}),
          'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.length), ...extra,
        } }, res => { const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) })); res.on('error', reject); });
      req.on('error', reject); req.end(body);
    });
  };
  it('authenticates dispatch, keeps proof out of Struct and supports repeated publication plus renewal', async () => {
    const dispatch = Object.create(PlaybookFlowExecutionService.prototype) as Record<string, unknown>;
    const Run = jest.fn((_request: unknown, _metadata: { get(name: string): unknown[] }) => ({ stream: true }));
    Object.assign(dispatch, { artifactService: service, configService: config, playbookFlowClient: { Run } });
    const request = { execution_id: executionId, owner_id: ownerId, input_context: { fields: {} } };
    await (dispatch.runRuntime as (value: unknown) => Promise<unknown>)(request);
    const token = Run.mock.calls[0][1].get('x-yellowstorm-artifact-authority')[0] as string;
    expect(JSON.stringify(request)).not.toContain(token);
    expect((await post('', token)).status).toBe(201);
    expect((await post('', token)).status).toBe(201);
    const renewed = await post('/authority/renew', token);
    expect(renewed.status).toBe(201);
    expect(signer.verifyAdkExecutionAuthority(renewed.body.token, 'playbook-artifact').generation).toBe('lease-acquisition-1');
    expect((await post('', renewed.body.token)).status).toBe(201);
  });
  it.each(['missing', 'foreign execution', 'foreign actor', 'root purpose', 'expired', 'MCP assertion', 'wrong signature'])('denies %s proof before storage', async scenario => {
    let token: string | undefined = await service.issuePublicationAuthority(executionId, ownerId);
    const claims = signer.verifyAdkExecutionAuthority(token, 'playbook-artifact');
    if (scenario === 'missing') token = undefined;
    if (scenario === 'foreign execution') token = signer.issueAdkExecutionAuthority({ ...claims, executionId: '507f1f77bcf86cd799439099' });
    if (scenario === 'foreign actor') token = signer.issueAdkExecutionAuthority({ ...claims, sub: '507f1f77bcf86cd799439099' });
    if (scenario === 'root purpose') token = signer.issueAdkExecutionAuthority({ ...claims, purpose: 'root-work' });
    if (scenario === 'expired' || scenario === 'MCP assertion' || scenario === 'wrong signature') {
      token = sign({ ...claims, jti: randomUUID(), ...(scenario === 'expired' ? { iat: Math.floor(Date.now() / 1000) - 400 } : {}) },
        scenario === 'wrong signature' ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : key,
        { algorithm: 'RS256', issuer: 'artifact-test', audience: 'yellowstorm-adk:playbook-artifact', expiresIn: 300,
          header: { alg: 'RS256', typ: scenario === 'MCP assertion' ? 'JWT' : 'adk-execution+jwt' } });
    }
    expect((await post('', token)).status).toBe(401);
    expect(documents.upload).not.toHaveBeenCalled();
    expect((await post('/authority/renew', token)).status).toBe(401);
  });
  it.each(['cancelled', 'failed', 'lease expired', 'lease takeover', 'new dispatch', 'actor revoked', 'permission revoked', 'resource revoked'])('checks live %s on publication and renewal', async scenario => {
    const token = await service.issuePublicationAuthority(executionId, ownerId);
    if (scenario === 'cancelled' || scenario === 'failed') executions.findOwned.mockResolvedValue({ ...execution, status: scenario });
    if (scenario === 'lease expired') leases.authorityGeneration.mockResolvedValue(null);
    if (scenario === 'lease takeover') leases.authorityGeneration.mockResolvedValue('lease-acquisition-2');
    if (scenario === 'new dispatch') executions.findOwned.mockResolvedValue({ ...execution, startedAt: new Date() });
    if (scenario === 'actor revoked') users.findById.mockResolvedValue({ status: 'suspended' });
    if (scenario === 'permission revoked') authorization.getUserPermissions.mockResolvedValue([]);
    if (scenario === 'resource revoked') access.assertExecutionAccess.mockRejectedValue(new Error('revoked'));
    expect((await post('', token)).status).not.toBe(201);
    expect((await post('/authority/renew', token)).status).not.toBe(201);
    expect(documents.upload).not.toHaveBeenCalled();
  });
  it('rejects duplicate proof, generic machine credentials and spoofed owner', async () => {
    const token = await service.issuePublicationAuthority(executionId, ownerId);
    expect((await post('', token, { 'X-YellowStorm-Execution-Authority': [token, token] })).status).toBe(401);
    expect((await post('', token, { 'X-YellowStorm-Service-Token': 'generic', 'X-Internal-Token': 'generic' })).status).toBe(401);
    expect((await post('', token, { 'X-YellowStorm-User-Id': '507f1f77bcf86cd799439099' })).status).toBe(401);
    expect(documents.upload).not.toHaveBeenCalled();
  });
  it('renews across an approval pause longer than the original TTL, but cannot publish until resumed', async () => {
    let token = await service.issuePublicationAuthority(executionId, ownerId);
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now');
    try {
      executions.findOwned.mockResolvedValue({ ...execution, status: 'pending_approval' });
      for (const seconds of [240, 480, 720]) {
        clock.mockReturnValue(now + seconds * 1000);
        const response = await post('/authority/renew', token);
        expect(response.status).toBe(201);
        token = response.body.token;
        expect(signer.verifyAdkExecutionAuthority(token, 'playbook-artifact').generation).toBe('lease-acquisition-1');
        expect((await post('', token)).status).toBe(401);
      }
      executions.findOwned.mockResolvedValue({ ...execution, status: 'running' });
      expect((await post('', token)).status).toBe(201);
      leases.authorityGeneration.mockResolvedValue('reclaimed-generation');
      expect((await post('/authority/renew', token)).status).toBe(401);
    } finally { clock.mockRestore(); }
  });
  it('fingerprints acquisition, not heartbeat updates, even if a lease row is reused', async () => {
    const row = { id: 'lease-row', createdAt: new Date(1000) };
    const repository = new ExecutionLeaseRepository({ select: () => ({ from: () => ({ where: async () => [row] }) }) } as never);
    const first = await repository.authorityGeneration(executionId, ownerId, flowId);
    expect(await repository.authorityGeneration(executionId, ownerId, flowId)).toBe(first);
    row.createdAt = new Date(2000);
    expect(await repository.authorityGeneration(executionId, ownerId, flowId)).not.toBe(first);
  });
});
