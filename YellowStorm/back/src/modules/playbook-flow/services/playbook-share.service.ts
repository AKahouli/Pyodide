import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SharedPlaybook, SharedPlaybookDocument } from '../schemas/shared-playbook.schema';
import { SharePlaybookDto, UpdatePlaybookSharePermissionDto } from '../dto/share-playbook.dto';
import {
  AssignablePlaybookPermission,
  IPlaybookShareEntry,
  ISharedPlaybookInfo,
} from '../interfaces/playbook-share.interface';

interface PopulatedUser {
  _id: string;
  email: string;
  profile?: { firstName?: string; lastName?: string };
}

function toPopulated(summary?: { id: string; email: string; firstName: string; lastName: string }): PopulatedUser | undefined {
  return summary
    ? { _id: summary.id, email: summary.email, profile: { firstName: summary.firstName, lastName: summary.lastName } }
    : undefined;
}

@Injectable()
export class PlaybookShareService {
  constructor(
    @InjectModel(SharedPlaybook.name)
    private readonly sharedPlaybookModel: Model<SharedPlaybookDocument>,
    @Inject(USER_LOOKUP_PORT) private readonly userLookup: UserLookupPort,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaybookShareService.name);
  }

  async sharePlaybook(ownerId: string, playbookId: string, dto: SharePlaybookDto): Promise<IPlaybookShareEntry[]> {
    const recipients = await this.resolveRecipients(ownerId, dto.emails);
    const results: IPlaybookShareEntry[] = [];

    for (const user of recipients) {
      const share = await this.sharedPlaybookModel.findOneAndUpdate(
        { playbookId: new Types.ObjectId(playbookId), sharedWith: user._id },
        {
          $set: { permission: dto.permission, sharedBy: new Types.ObjectId(ownerId) },
          $setOnInsert: { playbookId: new Types.ObjectId(playbookId), sharedWith: user._id },
        },
        { upsert: true, new: true },
      );
      results.push(this.mapShare(share, user));
    }

    this.logger.log('Playbook shared', {
      playbookId,
      ownerId,
      sharedWith: results.map((result) => result.user.email),
      permission: dto.permission,
    });

    return results;
  }

  async getPlaybookShares(playbookId: string): Promise<IPlaybookShareEntry[]> {
    const shares = await this.sharedPlaybookModel
      .find({ playbookId: new Types.ObjectId(playbookId) })
      .sort({ createdAt: -1 })
      .exec();

    const users = await this.userLookup.byIds(shares.map((share) => String(share.sharedWith)));
    return shares.map((share) => this.mapShare(share, toPopulated(users.get(String(share.sharedWith)))!));
  }

  async updateSharePermission(
    playbookId: string,
    shareId: string,
    dto: UpdatePlaybookSharePermissionDto,
  ): Promise<IPlaybookShareEntry> {
    if (!Types.ObjectId.isValid(shareId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook share not found');
    }

    const share = await this.sharedPlaybookModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(shareId), playbookId: new Types.ObjectId(playbookId) },
        { $set: { permission: dto.permission } },
        { new: true },
      )
      .exec();

    if (!share) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook share not found');
    }

    const users = await this.userLookup.byIds([String(share.sharedWith)]);
    this.logger.log('Playbook share permission updated', { playbookId, shareId, permission: dto.permission });
    return this.mapShare(share, toPopulated(users.get(String(share.sharedWith)))!);
  }

  async removeShare(playbookId: string, shareId: string): Promise<void> {
    if (!Types.ObjectId.isValid(shareId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook share not found');
    }

    const share = await this.sharedPlaybookModel
      .findOneAndDelete({ _id: new Types.ObjectId(shareId), playbookId: new Types.ObjectId(playbookId) })
      .lean()
      .exec();
    if (!share) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook share not found');
    }
  }

  async removeAllSharesForPlaybook(playbookId: string): Promise<void> {
    await this.sharedPlaybookModel.deleteMany({ playbookId: new Types.ObjectId(playbookId) }).exec();
  }

  async getSharePermission(userId: string, playbookId: string): Promise<AssignablePlaybookPermission | null> {
    const share = await this.sharedPlaybookModel
      .findOne({ playbookId: new Types.ObjectId(playbookId), sharedWith: new Types.ObjectId(userId) })
      .lean()
      .exec();
    return share ? share.permission : null;
  }

  async getSharedPlaybookIdsForUser(userId: string): Promise<string[]> {
    const shares = await this.sharedPlaybookModel
      .find({ sharedWith: new Types.ObjectId(userId) })
      .select('playbookId')
      .lean()
      .exec();
    return shares.map((share) => share.playbookId.toString());
  }

  async getShareInfoMapForUser(userId: string): Promise<Map<string, ISharedPlaybookInfo>> {
    const shares = await this.sharedPlaybookModel
      .find({ sharedWith: new Types.ObjectId(userId) })
      .lean()
      .exec();

    const users = await this.userLookup.byIds(shares.map((share) => String(share.sharedBy)));

    const shareMap = new Map<string, ISharedPlaybookInfo>();
    for (const share of shares) {
      const sharedBy = toPopulated(users.get(String(share.sharedBy)))!;
      shareMap.set(share.playbookId.toString(), {
        shareId: share._id.toString(),
        permission: share.permission,
        sharedBy: this.mapUser(sharedBy),
      });
    }
    return shareMap;
  }

  private async resolveRecipients(ownerId: string, emails: string[]): Promise<PopulatedUser[]> {
    const normalizedEmails = Array.from(new Set(emails.map((email) => email.toLowerCase().trim()).filter(Boolean)));
    const byEmail = await this.userLookup.byEmails(normalizedEmails);
    const resolved = normalizedEmails.map((email) => ({
      email,
      user: toPopulated(byEmail.get(email)),
    }));
    const notFound = resolved.filter((entry) => !entry.user).map((entry) => entry.email);
    if (notFound.length > 0) {
      this.logger.warn('Playbook share rejected unknown recipients', { ownerId, notFound });
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, `Unknown recipient(s): ${notFound.join(', ')}`);
    }
    const recipients = resolved.map((entry) => entry.user).filter((user): user is NonNullable<typeof user> => !!user);
    if (recipients.some((user) => user._id.toString() === ownerId)) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'You cannot share a playbook with yourself');
    }
    if (recipients.length === 0) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'No matching users found');
    }
    return recipients as unknown as PopulatedUser[];
  }

  private mapShare(share: SharedPlaybookDocument, user: PopulatedUser): IPlaybookShareEntry {
    return {
      shareId: share._id.toString(),
      permission: share.permission,
      user: this.mapUser(user),
      createdAt: share.createdAt,
    };
  }

  private mapUser(user: PopulatedUser) {
    return {
      id: user._id.toString(),
      email: user.email,
      firstName: user.profile?.firstName,
      lastName: user.profile?.lastName,
    };
  }
}
