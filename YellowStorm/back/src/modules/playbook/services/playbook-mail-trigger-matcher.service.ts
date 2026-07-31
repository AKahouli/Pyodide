import { Injectable } from '@nestjs/common';
import {
  MailTriggerMatchResultData,
  NormalizedMailEventData,
  PlaybookMailTriggerFiltersData,
} from '../interfaces/playbook.interface';

@Injectable()
export class PlaybookMailTriggerMatcherService {
  match(
    filters: PlaybookMailTriggerFiltersData,
    event: NormalizedMailEventData,
  ): MailTriggerMatchResultData {
    const reasons: string[] = [];

    if (filters.from.length > 0) {
      const sender = event.from.address.trim().toLowerCase();
      const fromMatched = filters.from.some((candidate) => candidate.trim().toLowerCase() === sender);
      if (!fromMatched) {
        reasons.push('from');
      }
    }

    if (filters.subjectContains.length > 0) {
      const subject = event.subject.toLowerCase();
      const subjectMatched = filters.subjectContains.some((needle) =>
        subject.includes(needle.trim().toLowerCase()),
      );
      if (!subjectMatched) {
        reasons.push('subjectContains');
      }
    }

    if (filters.bodyContains.length > 0) {
      const body = event.bodyText.toLowerCase();
      const bodyMatched = filters.bodyContains.some((needle) =>
        body.includes(needle.trim().toLowerCase()),
      );
      if (!bodyMatched) {
        reasons.push('bodyContains');
      }
    }

    if (typeof filters.hasAttachments === 'boolean' && filters.hasAttachments !== event.hasAttachments) {
      reasons.push('hasAttachments');
    }

    return {
      matched: reasons.length === 0,
      reasons,
    };
  }
}
