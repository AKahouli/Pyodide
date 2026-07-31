import { ExecutionContext } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlaybookOwnerGuard } from './playbook-owner.guard';
import { NotFoundException, ForbiddenException } from '../../exceptions';

describe('PlaybookOwnerGuard', () => {
  let guard: PlaybookOwnerGuard;
  let playbookModel: { findById: jest.Mock };

  const userId = new Types.ObjectId();
  const otherUserId = new Types.ObjectId();
  const playbookId = new Types.ObjectId().toString();

  const createMockContext = (
    params: { id?: string; playbookId?: string },
    user: { _id: Types.ObjectId },
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ params, user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();

    playbookModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ createdBy: userId }),
          }),
        }),
      }),
    };

    guard = new PlaybookOwnerGuard(playbookModel as any);
  });

  it('should allow access when createdBy matches user', async () => {
    const context = createMockContext({ id: playbookId }, { _id: userId });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(playbookModel.findById).toHaveBeenCalledWith(playbookId);
  });

  it('should use params.playbookId when params.id is absent', async () => {
    const context = createMockContext({ playbookId }, { _id: userId });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(playbookModel.findById).toHaveBeenCalledWith(playbookId);
  });

  it('should throw NotFoundException when playbook ID is missing', async () => {
    const context = createMockContext({}, { _id: userId });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException when playbook ID is invalid', async () => {
    const context = createMockContext({ id: 'not-an-objectid' }, { _id: userId });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException when playbook does not exist', async () => {
    playbookModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
    });

    const context = createMockContext({ id: playbookId }, { _id: userId });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });

  it('should throw ForbiddenException when createdBy does not match user', async () => {
    const context = createMockContext({ id: playbookId }, { _id: otherUserId });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should query only the createdBy field', async () => {
    const selectMock = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ createdBy: userId }),
      }),
    });
    playbookModel.findById.mockReturnValue({ select: selectMock });

    const context = createMockContext({ id: playbookId }, { _id: userId });
    await guard.canActivate(context);

    expect(selectMock).toHaveBeenCalledWith('createdBy');
  });
});
