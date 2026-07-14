import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';

import { ErrorCode } from '../../exceptions/constants/error-codes';
import { AgentPermissionGuard } from './agent-permission.guard';

function createExecutionContext(request: any): any {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  };
}

function createLeanExec<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('AgentPermissionGuard default agent authorization', () => {
  const userId = new Types.ObjectId();
  const agentId = new Types.ObjectId();
  const defaultAgent = {
    _id: agentId,
    createdBy: new Types.ObjectId(),
    isActive: true,
    isDefault: true,
  };

  function createGuard(requiredPermission: 'read' | 'write' | 'owner') {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredPermission),
    } as unknown as Reflector;
    const agentModel = {
      findById: jest.fn().mockReturnValue(createLeanExec(defaultAgent)),
    };
    const sharedAgentModel = {
      findOne: jest.fn(),
    };

    return {
      guard: new AgentPermissionGuard(reflector, agentModel as any, sharedAgentModel as any),
      sharedAgentModel,
    };
  }

  it('rejects owner-only access for default agents even with agents.update', async () => {
    const { guard, sharedAgentModel } = createGuard('owner');
    const request = {
      user: { _id: userId, permissions: ['agents.update'] },
      params: { id: agentId.toString() },
    };

    await expect(guard.canActivate(createExecutionContext(request))).rejects.toMatchObject({
      response: { message: ErrorCode.CUSTOM_AGENT_SHARE_FORBIDDEN },
    });
    expect(sharedAgentModel.findOne).not.toHaveBeenCalled();
  });

  it.each([['agents.update'], ['agents.*'], ['*']])(
    'allows default-agent write access with %s',
    async (permission) => {
      const { guard } = createGuard('write');
      const request: any = {
        user: { _id: userId, permissions: [permission] },
        params: { agentId: agentId.toString() },
      };

      await expect(guard.canActivate(createExecutionContext(request))).resolves.toBe(true);
      expect(request.agentContext.permission).toBe('owner');
    },
  );

  it('rejects default-agent write access without default management permission', async () => {
    const { guard } = createGuard('write');
    const request: any = {
      user: { _id: userId, permissions: ['agents.read'] },
      params: { agentId: agentId.toString() },
    };

    await expect(guard.canActivate(createExecutionContext(request))).rejects.toMatchObject({
      response: { message: ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY },
    });
  });
});
