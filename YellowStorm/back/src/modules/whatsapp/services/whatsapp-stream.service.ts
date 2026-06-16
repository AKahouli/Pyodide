import { Injectable } from '@nestjs/common';

import { StreamService } from '@modules/conversation/services/stream.service';

import { LoggerService } from '@modules/logger';



export interface WhatsAppStreamParams {

  userId: string;

  username: string;

  conversationId: string;

  messageId: string;

  linkedAgentId: string;

  query: string;

  requestId?: string;

}



@Injectable()

export class WhatsAppStreamService {

  constructor(

    private readonly logger: LoggerService,

    private readonly streamService: StreamService,

  ) {

    this.logger.setContext(WhatsAppStreamService.name);

  }



  async runStream(params: WhatsAppStreamParams): Promise<void> {

    const { userId, username, conversationId, messageId, linkedAgentId, query, requestId } =

      params;



    this.logger.log('WhatsApp RunSingleAgent gRPC starting', {

      conversationId,

      messageId,

      agentId: linkedAgentId,

      requestId,

    });



    const result = await this.streamService.runSingleAgentStream({

      userId,

      username,

      conversationId,

      messageId,

      agentId: linkedAgentId,

      query,

      requestId,

    });



    this.logger.log('WhatsApp RunSingleAgent gRPC completed', {

      conversationId,

      messageId,

      agentId: linkedAgentId,

      chunkCount: result.chunkCount,

      componentCount: result.componentCount,

      durationMs: result.durationMs,

      requestId,

    });

  }

}


