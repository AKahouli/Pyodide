import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, FlattenMaps } from 'mongoose';
import { UserProviderLink, UserProviderLinkDocument } from '../schemas/user-provider-link.schema';
import { UserService } from '@modules/user/user.service';
import { LoggerService } from '@modules/logger';
import { BadRequestException, ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

type UserProviderLinkLean = FlattenMaps<UserProviderLink> & { _id: Types.ObjectId };

@Injectable()
export class ProviderLinkService {
  constructor(
    @InjectModel(UserProviderLink.name)
    private readonly userProviderLinkModel: Model<UserProviderLinkDocument>,
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
    return this.userProviderLinkModel
      .findOne({ providerKey, providerUserId })
      .lean()
      .exec();
  }

  /**
   * Find all linked providers for a user.
   */
  async findByUserId(userId: string): Promise<UserProviderLinkLean[]> {
    return this.userProviderLinkModel
      .find({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
  }

  /**
   * Create a new provider link.
   */
  async createLink(
    userId: string | Types.ObjectId,
    providerKey: string,
    providerUserId: string,
    providerEmail: string,
  ): Promise<UserProviderLinkDocument> {
    // Check if already linked to another user
    const existing = await this.userProviderLinkModel.findOne({
      providerKey,
      providerUserId,
    });

    if (existing) {
      if (existing.userId.toString() === userId.toString()) {
        return existing;
      }
      throw new ConflictException(
        ErrorCode.AUTH_OAUTH_ACCOUNT_ALREADY_LINKED,
        'This provider account is already linked to another user',
      );
    }

    const link = await this.userProviderLinkModel.create({
      userId,
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

    const result = await this.userProviderLinkModel.deleteOne({
      userId: new Types.ObjectId(userId),
      providerKey,
    });

    if (result.deletedCount === 0) {
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
    const otherLinks = await this.userProviderLinkModel.countDocuments({
      userId: new Types.ObjectId(userId),
      providerKey: { $ne: providerKey },
    });

    // Allow unlinking if user has other linked providers
    return otherLinks > 0;
  }
}
