import { Injectable } from '@nestjs/common';
import { ConflictException, ErrorCode } from '../../exceptions';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import { StreamService } from '../services/stream.service';
import { RootWorkService } from './root-work.service';
import { ConversationRootResolverService } from './conversation-root-resolver.service';
import type { OngoingRequestContext } from '../utils/ongoing-request-context';

@Injectable()
export class RootConversationReplyService {
  constructor(private readonly work: RootWorkService, private readonly conversations: ConversationService,
    private readonly resolver: ConversationRootResolverService, private readonly messages: MessageService,
    private readonly stream: StreamService) {}

  async cancel(executionId: string, messageId: string) {
    const parent = await this.work.getExecution(executionId);
    const state = parent?.resultPayload?.nativeState;
    if (!/^[a-f0-9]{24}$/.test(messageId) || !parent || !state?.actorId || !parent.rootAgentId
      || parent.role !== 'root' || parent.depth !== 0 || !['running', 'waiting'].includes(parent.status)
      || state.scope.executionId !== parent.id || state.rootContext.root_agent_id !== parent.rootAgentId
      || messageId === state.origin?.assistantMessageId) throw denied();
    const requests = state.rootContext.ongoing_requests as OngoingRequestContext['ongoing_requests'] | undefined;
    const snapshot = Array.isArray(requests) ? requests.find((request) => request.assistant_message_ids?.includes(messageId)) : undefined;
    if (!snapshot) throw denied();
    const conversation = await this.conversations.getConversationDocument(parent.conversationId);
    if (conversation.createdBy !== state.actorId || conversation.isArchived || conversation.isGroup
      || conversation.rootAgentId !== parent.rootAgentId || (conversation.rootWorkEpoch ?? 0) !== parent.conversationEpoch) throw denied();
    const pool = await this.resolver.resolveForActor(parent.rootAgentId, state.actorId, parent.conversationId,
      state.rootContext.governance_revision ?? null);
    if (pool.rootSnapshotDigest !== state.scope.immutableSnapshotRef) throw denied();
    const target = await this.messages.findById(messageId);
    if (!target || target.conversationId !== parent.conversationId || target.conversationType !== 'ai'
      || target.questionMessageId !== snapshot.question_message_id) throw denied();
    if (target.isComplete && !target.isStreaming) return { messageId, status: 'already_terminal' };
    await this.stream.stopStream(state.actorId, parent.conversationId, messageId);
    // Remote replicas acknowledge durable intent before their stream stops.
    return { messageId, status: 'cancellation_requested' };
  }
}

const denied = () => new ConflictException(ErrorCode.VALIDATION_ERROR, 'Conversation reply control is not currently authorized');
