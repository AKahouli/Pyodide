import { AppDataEndUserGrantsService } from './app-data-end-user-grants.service';
import { AppDataGrantDeniedException } from '../constants/app-data.errors';

describe('AppDataEndUserGrantsService', () => {
  let service: AppDataEndUserGrantsService;
  let db: {
    insert: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(() => {
    db = {
      insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
      select: jest.fn(),
      update: jest.fn(),
    };
    service = new AppDataEndUserGrantsService(db as never);
  });

  it('maps policy operations to grant keys', () => {
    expect(AppDataEndUserGrantsService.policyOperationToGrant('insert')).toBe('create');
    expect(AppDataEndUserGrantsService.policyOperationToGrant('select')).toBe('read');
    expect(AppDataEndUserGrantsService.policyOperationToGrant('update')).toBe('update');
    expect(AppDataEndUserGrantsService.policyOperationToGrant('delete')).toBe('delete');
  });

  it('denies when grant is missing', async () => {
    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    await expect(service.assertAllowed('app-1', 'user-1', 'select')).rejects.toBeInstanceOf(
      AppDataGrantDeniedException,
    );
  });

  it('allows when grant is present', async () => {
    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([
            {
              canCreate: false,
              canRead: true,
              canUpdate: false,
              canDelete: false,
              canUseAi: false,
            },
          ]),
        }),
      }),
    });

    await expect(service.assertAllowed('app-1', 'user-1', 'select')).resolves.toBeUndefined();
  });

  it('denies AI usage when useAi is false', async () => {
    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([
            {
              canCreate: true,
              canRead: true,
              canUpdate: true,
              canDelete: true,
              canUseAi: false,
            },
          ]),
        }),
      }),
    });

    await expect(service.assertUseAi('app-1', 'user-1')).rejects.toBeInstanceOf(
      AppDataGrantDeniedException,
    );
  });

  it('allows AI usage when useAi is true', async () => {
    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([
            {
              canCreate: false,
              canRead: false,
              canUpdate: false,
              canDelete: false,
              canUseAi: true,
            },
          ]),
        }),
      }),
    });

    await expect(service.assertUseAi('app-1', 'user-1')).resolves.toBeUndefined();
  });

  it('mergeGrants keeps useAi when the body only updates CRUD flags', () => {
    const merged = AppDataEndUserGrantsService.mergeGrants(
      { create: true, read: true, update: false, delete: false, useAi: true },
      { create: false, read: true, update: true, delete: false },
    );
    expect(merged).toEqual({
      create: false,
      read: true,
      update: true,
      delete: false,
      useAi: true,
    });
  });

  it('mergeGrants can explicitly clear useAi', () => {
    const merged = AppDataEndUserGrantsService.mergeGrants(
      { create: true, read: true, update: true, delete: true, useAi: true },
      { useAi: false },
    );
    expect(merged.useAi).toBe(false);
    expect(merged.create).toBe(true);
  });
});
