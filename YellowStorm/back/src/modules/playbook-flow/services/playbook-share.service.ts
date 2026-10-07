import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SharedPlaybookRepository, type SharedPlaybookRecord } from '../persistence/shared-playbook.repository';
import { SharePlaybookDto, UpdatePlaybookSharePermissionDto } from '../dto/share-playbook.dto';
import { PlaybookFlowStreamEventsService } from './playbook-flow-stream-events.service';
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
    private readonly shares: SharedPlaybookRepository,
    @Inject(USER_LOOKUP_PORT) private readonly userLookup: UserLookupPort,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaybookShareService.name);
  }

  async sharePlaybook(ownerId: string, playbookId: string, dto: SharePlaybookDto): Promise<IPlaybookShareEntry[]> {
    const recipients = await this.resolveRecipients(ownerId, dto.emails);
    const results: IPlaybookShareEntry[] = [];

    for (const user of recipients) {
      const share = await this.shares.upsert(playbookId, user._id, ownerId, dto.permission);
      results.push(this.mapShare(share, user));
      this.streamEvents.emitPlaybookShared(user._id.toString(), playbookId);
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
    const shares = await this.shares.listForPlaybook(playbookId);

    const users = await this.userLookup.byIds(shares.map((share) => share.sharedWith));
    return shares.map((share) => this.mapShare(share, toPopulated(users.get(share.sharedWith))!));
  }

  async updateSharePermission(
    playbookId: string,
    shareId: string,
    dto: UpdatePlaybookSharePermissionDto,
  ): Promise<IPlaybookShareEntry> {
    const share = await this.shares.updatePermission(playbookId, shareId, dto.permission);
    if (!share) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook share not found');
    }

    const users = await this.userLookup.byIds([share.sharedWith]);
    this.logger.log('Playbook share permission updated', { playbookId, shareId, permission: dto.permission });
    return this.mapShare(share, toPopulated(users.get(share.sharedWith))!);
  }

  async removeShare(playbookId: string, shareId: string): Promise<void> {
    const share = await this.shares.delete(playbookId, shareId);
    if (!share) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook share not found');
    }
  }

  async removeAllSharesForPlaybook(playbookId: string): Promise<void> {
    await this.shares.deleteAllForPlaybook(playbookId);
  }

  async getSharePermission(userId: string, playbookId: string): Promise<AssignablePlaybookPermission | null> {
    return this.shares.findPermission(userId, playbookId);
  }

  async getSharedPlaybookIdsForUser(userId: string): Promise<string[]> {
    return this.shares.listPlaybookIdsSharedWith(userId);
  }

  async getShareInfoMapForUser(userId: string): Promise<Map<string, ISharedPlaybookInfo>> {
    const shares = await this.shares.listSharedWith(userId);

    const users = await this.userLookup.byIds(shares.map((share) => share.sharedBy));

    const shareMap = new Map<string, ISharedPlaybookInfo>();
    for (const share of shares) {
      const sharedBy = toPopulated(users.get(share.sharedBy))!;
      shareMap.set(share.playbookId, {
        shareId: share.id,
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
    return recipients;
  }

  private mapShare(share: SharedPlaybookRecord, user: PopulatedUser): IPlaybookShareEntry {
    return {
      shareId: share.id,
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
