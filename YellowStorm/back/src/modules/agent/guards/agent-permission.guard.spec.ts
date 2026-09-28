import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ErrorCode } from '../../exceptions/constants/error-codes';
import { AgentPermissionGuard } from './agent-permission.guard';
import { PgAgentShareStore } from '../persistence/pg-agent-share.store';
import type { AgentRecord } from '../repositories/agent-record.mapper';
import { newObjectId } from '@common/postgres/object-id';

function createExecutionContext(request: any): any {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  };
}

/**
 * Full authorization matrix (remediation 6.1) exercised through a fake
 * agent share store — the original spec only covered default agents and
 * never reached the share path.
 */
describe('AgentPermissionGuard authorization matrix', () => {
  const ownerId = newObjectId();
  const shareUserId = newObjectId();
  const agentId = newObjectId();
  const shareId = newObjectId();

  const ownedAgent = { id: agentId, createdBy: ownerId, isActive: true, isDefault: false } as unknown as AgentRecord;
  const defaultAgent = { id: agentId, createdBy: ownerId, isActive: true, isDefault: true } as unknown as AgentRecord;

  function createGuard(requiredPermission: 'read' | 'write' | 'owner', agent: AgentRecord | null, share?: { id: string; permission: string } | null) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredPermission),
    } as unknown as Reflector;
    const agentRepository = { findById: jest.fn().mockResolvedValue(agent) };
    const shareStore = {
      find: jest.fn().mockResolvedValue(share ?? null),
    } as unknown as PgAgentShareStore;
    return { guard: new AgentPermissionGuard(reflector, agentRepository as any, shareStore), shareStore };
  }

  const requestFor = (userId: string, permissions: string[] = []): any => ({
    user: { _id: userId, permissions },
    params: { id: agentId },
  });

  it('owner passes with permission=owner and no share lookup', async () => {
    const { guard, shareStore } = createGuard('write', ownedAgent);
    const request = requestFor(ownerId, []);
    await expect(guard.canActivate(createExecutionContext(request))).resolves.toBe(true);
    expect(request.agentContext).toMatchObject({ isOwner: true, permission: 'owner' });
    expect(shareStore.find).not.toHaveBeenCalled();
  });

  it('non-owner without a share is forbidden', async () => {
    const { guard } = createGuard('read', ownedAgent);
    await expect(guard.canActivate(createExecutionContext(requestFor(shareUserId, [])))).rejects.toMatchObject({
      response: { message: ErrorCode.CUSTOM_AGENT_FORBIDDEN },
    });
  });

  it('shared read grants read and exposes shareId', async () => {
    const { guard } = createGuard('read', ownedAgent, { id: shareId, permission: 'read' });
    const request = requestFor(shareUserId);
    await expect(guard.canActivate(createExecutionContext(request))).resolves.toBe(true);
    expect(request.agentContext).toMatchObject({ isOwner: false, permission: 'read', shareId });
  });

  it('shared write grants write and exposes shareId', async () => {
    const { guard } = createGuard('write', ownedAgent, { id: shareId, permission: 'write' });
    const request = requestFor(shareUserId);
    await expect(guard.canActivate(createExecutionContext(request))).resolves.toBe(true);
    expect(request.agentContext).toMatchObject({ permission: 'write', shareId });
  });

  it('write required with only a read share is forbidden (403)', async () => {
    const { guard } = createGuard('write', ownedAgent, { id: shareId, permission: 'read' });
    await expect(guard.canActivate(createExecutionContext(requestFor(shareUserId)))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('owner-only endpoints reject non-owners before any share lookup', async () => {
    const { guard, shareStore } = createGuard('owner', ownedAgent, { id: shareId, permission: 'write' });
    await expect(guard.canActivate(createExecutionContext(requestFor(shareUserId)))).rejects.toMatchObject({
      response: { message: ErrorCode.CUSTOM_AGENT_SHARE_FORBIDDEN },
    });
    expect(shareStore.find).not.toHaveBeenCalled();
  });

  it('default agent: read passes, write needs default-management permission, owner is forbidden', async () => {
    const read = createGuard('read', defaultAgent);
    await expect(read.guard.canActivate(createExecutionContext(requestFor(shareUserId)))).resolves.toBe(true);

    const write = createGuard('write', defaultAgent);
    await expect(write.guard.canActivate(createExecutionContext(requestFor(shareUserId, ['agents.update'])))).resolves.toBe(true);

    const writeDenied = createGuard('write', defaultAgent);
    await expect(writeDenied.guard.canActivate(createExecutionContext(requestFor(shareUserId, ['agents.read'])))).rejects.toMatchObject({
      response: { message: ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY },
    });

    const ownerOnly = createGuard('owner', defaultAgent);
    await expect(ownerOnly.guard.canActivate(createExecutionContext(requestFor(ownerId, ['*'])))).rejects.toMatchObject({
      response: { message: ErrorCode.CUSTOM_AGENT_SHARE_FORBIDDEN },
    });
  });

  it('unknown agent → 404, malformed id → 404', async () => {
    const missing = createGuard('read', null);
    await expect(missing.guard.canActivate(createExecutionContext(requestFor(ownerId)))).rejects.toBeInstanceOf(NotFoundException);

    const malformed = createGuard('read', ownedAgent);
    const request = { user: { _id: ownerId }, params: { id: 'not-an-id' } };
    await expect(malformed.guard.canActivate(createExecutionContext(request))).rejects.toBeInstanceOf(NotFoundException);
  });
});
