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
            },
          ]),
        }),
      }),
    });

    await expect(service.assertAllowed('app-1', 'user-1', 'select')).resolves.toBeUndefined();
  });
});
