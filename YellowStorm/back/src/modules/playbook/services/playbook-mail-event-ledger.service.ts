import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import {
  MailEventLedgerEntryData,
  NormalizedMailEventData,
} from '../interfaces/playbook.interface';

@Injectable()
export class PlaybookMailEventLedgerService {
  buildDedupeKey(event: NormalizedMailEventData): string {
    return [event.provider, event.mailboxAppKey, event.providerMessageId].join(':');
  }

  createLedgerEntry(event: NormalizedMailEventData): MailEventLedgerEntryData {
    return {
      id: nanoid(),
      dedupeKey: this.buildDedupeKey(event),
      status: 'normalized',
      event,
      error: null,
      createdAt: new Date().toISOString(),
    };
  }

  isDuplicate(existingEntries: Array<{ dedupeKey: string }>, event: NormalizedMailEventData): boolean {
    const dedupeKey = this.buildDedupeKey(event);
    return existingEntries.some((entry) => entry.dedupeKey === dedupeKey);
  }
}
