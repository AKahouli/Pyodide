import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ProviderLinkService } from './provider-link.service';
import { UserProviderLink } from '../schemas/user-provider-link.schema';
import { UserService } from '@modules/user/user.service';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

function createQueryChain(resolvedValue: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['select', 'lean', 'sort', 'skip', 'limit', 'populate'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('ProviderLinkService', () => {
  let service: ProviderLinkService;
  let userProviderLinkModel: Record<string, jest.Mock>;
  let userService: Record<string, jest.Mock>;

  const MOCK_USER_ID = new Types.ObjectId();
  const MOCK_LINK = {
    _id: new Types.ObjectId(),
    userId: MOCK_USER_ID,
    providerKey: 'microsoft',
    providerUserId: 'ms-user-123',
    providerEmail: 'user@example.com',
    linkedAt: new Date(),
  };

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    userProviderLinkModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      deleteOne: jest.fn(),
      countDocuments: jest.fn(),
    };

    userService = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderLinkService,
        { provide: getModelToken(UserProviderLink.name), useValue: userProviderLinkModel },
        { provide: UserService, useValue: userService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get<ProviderLinkService>(ProviderLinkService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findByProviderUser', () => {
    it('should find a link by provider key and user ID', async () => {
      const chain = createQueryChain(MOCK_LINK);
      userProviderLinkModel.findOne.mockReturnValue(chain);

      const result = await service.findByProviderUser('microsoft', 'ms-user-123');

      expect(result).toEqual(MOCK_LINK);
      expect(userProviderLinkModel.findOne).toHaveBeenCalledWith({
        providerKey: 'microsoft',
        providerUserId: 'ms-user-123',
      });
    });

    it('should return null when not found', async () => {
      const chain = createQueryChain(null);
      userProviderLinkModel.findOne.mockReturnValue(chain);

      const result = await service.findByProviderUser('unknown', 'unknown');

      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should return all links for a user', async () => {
      const chain = createQueryChain([MOCK_LINK]);
      userProviderLinkModel.find.mockReturnValue(chain);

      const result = await service.findByUserId(MOCK_USER_ID.toHexString());

      expect(result).toHaveLength(1);
    });
  });

  describe('createLink', () => {
    it('should create a new link', async () => {
      userProviderLinkModel.findOne.mockResolvedValue(null);
      userProviderLinkModel.create.mockResolvedValue(MOCK_LINK);

      const result = await service.createLink(
        MOCK_USER_ID,
        'microsoft',
        'ms-user-123',
        'user@example.com',
      );

      expect(result).toEqual(MOCK_LINK);
      expect(userProviderLinkModel.create).toHaveBeenCalledWith({
        userId: MOCK_USER_ID,
        providerKey: 'microsoft',
        providerUserId: 'ms-user-123',
        providerEmail: 'user@example.com',
        linkedAt: expect.any(Date),
      });
    });

    it('should return existing link if same user already linked', async () => {
      userProviderLinkModel.findOne.mockResolvedValue(MOCK_LINK);

      const result = await service.createLink(
        MOCK_USER_ID,
        'microsoft',
        'ms-user-123',
        'user@example.com',
      );

      expect(result).toEqual(MOCK_LINK);
      expect(userProviderLinkModel.create).not.toHaveBeenCalled();
    });

    it('should throw when provider account is linked to another user', async () => {
      const otherUserId = new Types.ObjectId();
      userProviderLinkModel.findOne.mockResolvedValue({
        ...MOCK_LINK,
        userId: otherUserId,
      });

      await expect(
        service.createLink(MOCK_USER_ID, 'microsoft', 'ms-user-123', 'user@example.com'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_ACCOUNT_ALREADY_LINKED,
      });
    });
  });

  describe('deleteLink', () => {
    it('should delete a link when user has other providers', async () => {
      userService.findById.mockResolvedValue({ _id: MOCK_USER_ID });
      userProviderLinkModel.countDocuments.mockResolvedValue(1); // 1 other provider
      userProviderLinkModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await service.deleteLink(MOCK_USER_ID.toHexString(), 'microsoft');

      expect(userProviderLinkModel.deleteOne).toHaveBeenCalled();
    });

    it('should reject when it is the only auth method', async () => {
      userService.findById.mockResolvedValue({ _id: MOCK_USER_ID });
      userProviderLinkModel.countDocuments.mockResolvedValue(0); // no other providers

      await expect(
        service.deleteLink(MOCK_USER_ID.toHexString(), 'microsoft'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_FAILED,
      });
    });

    it('should throw when link not found', async () => {
      userService.findById.mockResolvedValue({ _id: MOCK_USER_ID });
      userProviderLinkModel.countDocuments.mockResolvedValue(1);
      userProviderLinkModel.deleteOne.mockResolvedValue({ deletedCount: 0 });

      await expect(
        service.deleteLink(MOCK_USER_ID.toHexString(), 'unknown'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_PROVIDER_NOT_FOUND,
      });
    });
  });

  describe('canUnlink', () => {
    it('should return true when user has other linked providers', async () => {
      userService.findById.mockResolvedValue({ _id: MOCK_USER_ID });
      userProviderLinkModel.countDocuments.mockResolvedValue(1);

      const result = await service.canUnlink(MOCK_USER_ID.toHexString(), 'microsoft');

      expect(result).toBe(true);
    });

    it('should return false when no other providers exist', async () => {
      userService.findById.mockResolvedValue({ _id: MOCK_USER_ID });
      userProviderLinkModel.countDocuments.mockResolvedValue(0);

      const result = await service.canUnlink(MOCK_USER_ID.toHexString(), 'microsoft');

      expect(result).toBe(false);
    });

    it('should return false when user not found', async () => {
      userService.findById.mockResolvedValue(null);

      const result = await service.canUnlink(MOCK_USER_ID.toHexString(), 'microsoft');

      expect(result).toBe(false);
    });
  });
});
