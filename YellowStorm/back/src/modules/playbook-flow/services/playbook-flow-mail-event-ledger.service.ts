import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { FlowNormalizedMailEventData, FlowMailEventLedgerEntryData } from '../interfaces/playbook-flow-mail.interface';

@Injectable()
export class PlaybookFlowMailEventLedgerService {
  buildDedupeKey(event: FlowNormalizedMailEventData): string {
    return [event.provider, event.mailboxAppKey, event.providerMessageId].join(':');
  }

  createLedgerEntry(event: FlowNormalizedMailEventData): FlowMailEventLedgerEntryData {
    return {
      id: nanoid(),
      dedupeKey: this.buildDedupeKey(event),
      status: 'normalized',
      event,
      error: null,
      createdAt: new Date().toISOString(),
    };
  }

  isDuplicate(existingEntries: Array<{ dedupeKey: string }>, event: FlowNormalizedMailEventData): boolean {
    const dedupeKey = this.buildDedupeKey(event);
    return existingEntries.some((entry) => entry.dedupeKey === dedupeKey);
  }
}
