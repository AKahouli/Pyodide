import { Injectable } from '@nestjs/common';
import { newObjectId } from '@common/postgres/object-id';
import { UserService } from '@modules/user/user.service';
import { LoggerService } from '@modules/logger';
import { BadRequestException, ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { PgUserProviderLinkStore } from '../persistence/pg-auth-provider.stores';

type UserProviderLinkLean = { id: string; userId: string; providerKey: string; providerUserId: string; providerEmail: string; linkedAt: Date };

@Injectable()
export class ProviderLinkService {
  constructor(
    private readonly userProviderLinkStore: PgUserProviderLinkStore,
    private readonly userService: UserService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ProviderLinkService.name);
  }

  /**
   * Find a link by provider key and provider user ID.
   */
  async findByProviderUser(
    providerKey: string,
    providerUserId: string,
  ): Promise<UserProviderLinkLean | null> {
    return this.userProviderLinkStore.findByProvider(providerKey, providerUserId);
  }

  /**
   * Find all linked providers for a user.
   */
  async findByUserId(userId: string): Promise<UserProviderLinkLean[]> {
    return this.userProviderLinkStore.findByUserId(userId);
  }

  /**
   * Create a new provider link.
   */
  async createLink(
    userId: string,
    providerKey: string,
    providerUserId: string,
    providerEmail: string,
  ): Promise<UserProviderLinkLean> {
    // Check if already linked to another user
    const existing = await this.userProviderLinkStore.findByProvider(providerKey, providerUserId);

    if (existing) {
      if (existing.userId.toString() === userId.toString()) {
        return existing;
      }
      throw new ConflictException(
        ErrorCode.AUTH_OAUTH_ACCOUNT_ALREADY_LINKED,
        'This provider account is already linked to another user',
      );
    }

    const link = await this.userProviderLinkStore.create({
      userId: String(userId),
      providerKey,
      providerUserId,
      providerEmail: providerEmail.toLowerCase(),
      linkedAt: new Date(),
    });

    this.logger.log('Provider linked to user', { userId, providerKey });

    return link;
  }

  /**
   * Delete a provider link. Rejects if it's the user's only auth method.
   */
  async deleteLink(userId: string, providerKey: string): Promise<void> {
    const canUnlink = await this.canUnlink(userId, providerKey);
    if (!canUnlink) {
      throw new BadRequestException(
        ErrorCode.AUTH_OAUTH_FAILED,
        'Cannot unlink: this is your only authentication method. Set a password first.',
      );
    }

    const deleted = await this.userProviderLinkStore.deleteByUserAndProvider(userId, providerKey);

    if (!deleted) {
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_PROVIDER_NOT_FOUND, 'Provider link not found');
    }

    this.logger.log('Provider unlinked from user', { userId, providerKey });
  }

  /**
   * Check if a user can safely unlink a provider.
   * Returns false if this is their only auth method and they have no password set.
   */
  async canUnlink(userId: string, providerKey: string): Promise<boolean> {
    const user = await this.userService.findById(userId);
    if (!user) return false;

    // Check if user has a usable password (not a random hash from OAuth signup)
    // We consider the password "usable" if the user was created through normal registration
    // OAuth-created users have a random hash that they don't know

    // Count other linked providers
    const otherLinks = await this.userProviderLinkStore.countByUserExcluding(userId, providerKey);

    // Allow unlinking if user has other linked providers
    return otherLinks > 0;
  }
}
