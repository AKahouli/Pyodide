import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ProviderLinkService } from './provider-link.service';
import { UserService } from '@modules/user/user.service';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  linkRecord,
  makeUserProviderLinkStoreFake,
  type UserProviderLinkStoreFake,
} from '../persistence/auth-provider-stores.fake';
import { PgUserProviderLinkStore } from '../persistence/pg-auth-provider.stores';

describe('ProviderLinkService', () => {
  let service: ProviderLinkService;
  let linkStore: UserProviderLinkStoreFake;
  let userService: Record<string, jest.Mock>;

  const userId = new Types.ObjectId().toString();
  const linkSeed = linkRecord({
    userId,
    providerKey: 'microsoft',
    providerUserId: 'ms-user-123',
    providerEmail: 'user@example.com',
  });

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    linkStore = makeUserProviderLinkStoreFake([linkSeed]);
    userService = {
      findById: jest.fn().mockResolvedValue({ _id: userId }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderLinkService,
        { provide: PgUserProviderLinkStore, useValue: linkStore },
        { provide: UserService, useValue: userService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get<ProviderLinkService>(ProviderLinkService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findByProviderUser', () => {
    it('should find a link by provider key and user id', async () => {
      const result = await service.findByProviderUser('microsoft', 'ms-user-123');
      expect(result?.id).toBe(linkSeed.id);
    });

    it('should return null when not found', async () => {
      expect(await service.findByProviderUser('unknown', 'unknown')).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should return all links for a user', async () => {
      const result = await service.findByUserId(userId);
      expect(result).toHaveLength(1);
    });
  });

  describe('createLink', () => {
    it('should create a new link', async () => {
      linkStore.records.splice(0);

      const result = await service.createLink(userId, 'microsoft', 'ms-user-123', 'user@example.com');

      expect(result).toMatchObject({
        userId,
        providerKey: 'microsoft',
        providerUserId: 'ms-user-123',
        providerEmail: 'user@example.com',
      });
    });

    it('should return existing link if same user already linked', async () => {
      const result = await service.createLink(userId, 'microsoft', 'ms-user-123', 'user@example.com');

      expect(result.id).toBe(linkSeed.id);
      expect(linkStore.records).toHaveLength(1);
    });

    it('should throw when provider account is linked to another user', async () => {
      const otherUserId = new Types.ObjectId().toString();
      linkStore.records.splice(0);
      linkStore.records.push(linkRecord({
        userId: otherUserId,
        providerKey: 'microsoft',
        providerUserId: 'ms-user-123',
      }));

      await expect(
        service.createLink(userId, 'microsoft', 'ms-user-123', 'user@example.com'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_OAUTH_ACCOUNT_ALREADY_LINKED });
    });
  });

  describe('deleteLink', () => {
    it('should delete a link when user has other providers', async () => {
      linkStore.records.push(linkRecord({ userId, providerKey: 'google', providerUserId: 'g-1' }));

      await service.deleteLink(userId, 'microsoft');

      expect(linkStore.records.some((r) => r.providerKey === 'microsoft')).toBe(false);
    });

    it('should reject when it is the only auth method', async () => {
      await expect(
        service.deleteLink(userId, 'microsoft'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_OAUTH_FAILED });
    });

    it('should throw when link not found', async () => {
      linkStore.records.push(linkRecord({ userId, providerKey: 'google', providerUserId: 'g-1' }));

      await expect(
        service.deleteLink(userId, 'unknown'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_OAUTH_PROVIDER_NOT_FOUND });
    });
  });

  describe('canUnlink', () => {
    it('should return true when user has other linked providers', async () => {
      linkStore.records.push(linkRecord({ userId, providerKey: 'google', providerUserId: 'g-1' }));

      expect(await service.canUnlink(userId, 'microsoft')).toBe(true);
    });

    it('should return false when no other providers exist', async () => {
      expect(await service.canUnlink(userId, 'microsoft')).toBe(false);
    });

    it('should return false when user not found', async () => {
      userService.findById.mockResolvedValue(null);

      expect(await service.canUnlink(userId, 'microsoft')).toBe(false);
    });
  });
});
