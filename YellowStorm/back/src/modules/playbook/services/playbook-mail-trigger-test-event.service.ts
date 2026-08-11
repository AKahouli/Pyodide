import { Injectable } from '@nestjs/common';
import { ConnectedAppTokenService } from '../../connected-app/services/connected-app-token.service';
import { TestPlaybookMailEventDto } from '../dto/test-playbook-mail-event.dto';
import { NormalizedMailEventData } from '../interfaces/playbook.interface';
import { PlaybookMailTriggerOrchestrationService } from './playbook-mail-trigger-orchestration.service';
import { PlaybookMailTriggerHandoffService } from './playbook-mail-trigger-handoff.service';

@Injectable()
export class PlaybookMailTriggerTestEventService {
  constructor(
    private readonly connectedAppTokenService: ConnectedAppTokenService,
    private readonly orchestrationService: PlaybookMailTriggerOrchestrationService,
    private readonly handoffService: PlaybookMailTriggerHandoffService,
  ) {}

  async processTestEvent(
    playbookId: string,
    userId: string,
    userEmail: string,
    dto: TestPlaybookMailEventDto,
  ) {
    const mailboxCapability = await this.connectedAppTokenService.getMailboxCapability(userId);

    const normalizedEvent: NormalizedMailEventData = {
      provider: 'm365',
      mailboxAppKey: dto.mailboxAppKey,
      providerMessageId: dto.providerMessageId,
      providerThreadId: dto.providerThreadId ?? null,
      receivedAt: dto.receivedAt,
      occurredAt: dto.occurredAt,
      subject: dto.subject ?? '',
      bodyText: dto.bodyText ?? '',
      bodyHtml: dto.bodyHtml ?? null,
      from: {
        name: dto.from.name ?? null,
        address: dto.from.address,
      },
      to: (dto.to ?? []).map((item) => ({ name: item.name ?? null, address: item.address })),
      cc: (dto.cc ?? []).map((item) => ({ name: item.name ?? null, address: item.address })),
      hasAttachments: dto.hasAttachments === true,
      attachments: [],
    };

    const evaluation = await this.orchestrationService.ingestAndEvaluate(playbookId, normalizedEvent);
    const handoff = evaluation.finalStatus === 'matched'
      ? await this.handoffService.handoffMatchedEvent(
        playbookId,
        userId,
        userEmail,
        evaluation.ingestion.entry.id,
      )
      : { executionId: null, handedOff: false, skippedReason: 'not-matched' as const };

    return {
      mailboxCapability,
      evaluation,
      handoff,
    };
  }
}
