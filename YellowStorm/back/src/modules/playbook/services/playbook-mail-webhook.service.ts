import { Injectable } from '@nestjs/common';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import { PlaybookMailGraphClientService } from './playbook-mail-graph-client.service';
import { PlaybookMailTriggerOrchestrationService } from './playbook-mail-trigger-orchestration.service';
import { PlaybookMailTriggerHandoffService } from './playbook-mail-trigger-handoff.service';
import { NormalizedMailEventData } from '../interfaces/playbook.interface';

@Injectable()
export class PlaybookMailWebhookService {
  constructor(
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
    private readonly graphClient: PlaybookMailGraphClientService,
    private readonly orchestrationService: PlaybookMailTriggerOrchestrationService,
    private readonly handoffService: PlaybookMailTriggerHandoffService,
  ) {}

  async handleNotifications(payload: { value?: Array<Record<string, any>> }) {
    const results: Array<Record<string, any>> = [];

    for (const item of payload.value || []) {
      const subscriptionId = item.subscriptionId as string | undefined;
      const resourceData = (item.resourceData || {}) as Record<string, any>;
      const messageId = resourceData.id as string | undefined;
      if (!subscriptionId || !messageId) {
        continue;
      }

      const playbook = await this.playbookModel
        .findOne({ 'mailTrigger.subscriptionId': subscriptionId })
        .select('_id createdBy mailTrigger')
        .lean()
        .exec();

      if (
        !playbook ||
        !playbook.mailTrigger?.mailboxAppKey ||
        !playbook.mailTrigger?.subscriptionClientState ||
        item.clientState !== playbook.mailTrigger.subscriptionClientState
      ) {
        continue;
      }

      const graphMessage = await this.graphClient.getMessage(
        playbook.createdBy.toString(),
        playbook.mailTrigger.mailboxAppKey,
        messageId,
      );

      const normalizedEvent: NormalizedMailEventData = {
        provider: 'm365',
        mailboxAppKey: playbook.mailTrigger.mailboxAppKey,
        providerMessageId: graphMessage.id,
        providerThreadId: graphMessage.conversationId ?? null,
        receivedAt: graphMessage.receivedDateTime,
        occurredAt: graphMessage.receivedDateTime,
        subject: graphMessage.subject ?? '',
        bodyText: graphMessage.bodyPreview ?? '',
        bodyHtml: graphMessage.body?.content ?? null,
        from: {
          name: graphMessage.from?.emailAddress?.name ?? null,
          address: graphMessage.from?.emailAddress?.address ?? '',
        },
        to: (graphMessage.toRecipients || []).map((entry: any) => ({
          name: entry?.emailAddress?.name ?? null,
          address: entry?.emailAddress?.address ?? '',
        })),
        cc: (graphMessage.ccRecipients || []).map((entry: any) => ({
          name: entry?.emailAddress?.name ?? null,
          address: entry?.emailAddress?.address ?? '',
        })),
        hasAttachments: graphMessage.hasAttachments === true,
        attachments: [],
      };

      const evaluation = await this.orchestrationService.ingestAndEvaluate(
        playbook._id.toString(),
        normalizedEvent,
      );

      const handoff = evaluation.finalStatus === 'matched'
        ? await this.handoffService.handoffMatchedEvent(
          playbook._id.toString(),
          playbook.createdBy.toString(),
          '',
          evaluation.ingestion.entry.id,
        )
        : { executionId: null, handedOff: false, skippedReason: 'not-matched' };

      results.push({
        subscriptionId,
        playbookId: playbook._id.toString(),
        evaluation,
        handoff,
      });
    }

    return { processed: results.length, results };
  }
}
