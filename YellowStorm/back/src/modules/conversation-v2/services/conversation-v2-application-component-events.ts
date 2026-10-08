import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type {
  ApplicationComponentEventPublisher,
  ApplicationComponentEventSource,
  ApplicationComponentPublishInput,
  ApplicationComponentStoredEvent,
} from '@modules/app-runtime/ports/application-component-events.port';
import { ConversationV2EventStoreService } from './conversation-v2-event-store.service';
import { ConversationV2StreamService } from './conversation-v2-stream.service';

/**
 * Bridges the App Runtime `application_component` ports to Conversation V2's
 * stream and event store, translating between the camelCase port inputs and
 * the snake_case wire payload.
 *
 * forwardRef: StreamService also depends on App Runtime services that inject
 * this port — without it Nest deadlocks during bootstrap and exits 0.
 */
@Injectable()
export class ConversationV2ApplicationComponentEvents
  implements ApplicationComponentEventPublisher, ApplicationComponentEventSource
{
  constructor(
    @Inject(forwardRef(() => ConversationV2StreamService))
    private readonly stream: ConversationV2StreamService,
    @Inject(ConversationV2EventStoreService)
    private readonly eventStore: ConversationV2EventStoreService,
  ) {}

  async publishApplicationComponent(
    userId: string,
    sessionOrWorkspaceId: string,
    input: ApplicationComponentPublishInput,
  ): Promise<void> {
    await this.stream.publishApplicationComponent(userId, sessionOrWorkspaceId, {
      event_id: input.eventId,
      timestamp: input.timestamp,
      url: input.url,
      title: input.title,
      ceph_path: input.cephPath,
      files_tree: input.filesTree,
      file_count: input.fileCount,
      revision_id: input.revisionId,
    });
  }

  async listApplicationComponents(
    sessionId: string,
  ): Promise<ApplicationComponentStoredEvent[]> {
    const rows = await this.eventStore.listByType(sessionId, 'application_component');
    return rows.map((row) => ({
      eventId: row.eventId,
      emittedAt: row.emittedAt,
      payload: row.payload,
    }));
  }
}