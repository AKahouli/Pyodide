import { ProjectOwnerGuard } from './project-owner.guard';

const OWNER_ID = '61a1b2c3d4e5f6a7b8c9d0e1';
const PROJECT_ID = '61a1b2c3d4e5f6a7b8c9d0e3';

function ctx(id: string) {
  const request: Record<string, unknown> = { user: { _id: { toString: () => OWNER_ID } }, params: { id } };
  return { request, context: { switchToHttp: () => ({ getRequest: () => request }) } as never };
}

describe('ProjectOwnerGuard', () => {
  it('accepts uppercase hex ids and looks them up lowercased', async () => {
    const findById = jest.fn().mockResolvedValue({ id: PROJECT_ID, createdBy: OWNER_ID });
    const guard = new ProjectOwnerGuard({ findById } as never);
    const { request, context } = ctx(PROJECT_ID.toUpperCase());
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findById).toHaveBeenCalledWith(PROJECT_ID);
    expect(request.project).toMatchObject({ id: PROJECT_ID });
  });

  it('rejects malformed ids without querying', async () => {
    const findById = jest.fn();
    const guard = new ProjectOwnerGuard({ findById } as never);
    await expect(guard.canActivate(ctx('not-an-id').context)).rejects.toBeDefined();
    expect(findById).not.toHaveBeenCalled();
  });
});
