import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { Agent, AgentDocument } from '../schemas/agent.schema';
import { AgentService } from '../agent.service';
import { A2AAdminGrpcClientService } from './a2a-admin.grpc-client.service';
import {
  ChatbotAgentInput,
  PublishAgentResult,
  RotateKeyResult,
} from '../types/a2a-admin.types';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

/**
 * Application service that publishes a personal agent over the A2A protocol and
 * rotates its API key. It bridges the persisted Agent document (ownership +
 * gRPC-agent assembly via {@link AgentService}) with the A2A admin gRPC client.
 *
 * Only personal (non-default) agents owned by the caller may be published.
 */
@Injectable()
export class A2APublishService {
  constructor(
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    private readonly agentService: AgentService,
    private readonly grpcClient: A2AAdminGrpcClientService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(A2APublishService.name);
  }

  /**
   * Publish (or re-publish) the agent over A2A. Builds the full gRPC agent
   * definition, hands it to the A2A admin service, and persists the returned
   * non-secret metadata. The API key is returned to the caller once and never
   * stored.
   */
  async publish(userId: string, agentId: string): Promise<PublishAgentResult> {
    const agent = await this.loadOwnedPersonalAgent(userId, agentId);

    const [grpcAgent] = await this.agentService.buildGrpcAgentsForPlaybook(
      userId,
      [agentId],
      agent.llmModel,
    );
    if (!grpcAgent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    let result: PublishAgentResult;
    try {
      result = await this.grpcClient.publishAgent(
        grpcAgent as unknown as ChatbotAgentInput,
        userId,
      );
    } catch (err) {
      this.logger.error('A2A publish failed', {
        agentId,
        userId,
        error: (err as Error).message,
      });
      throw new ConflictException(ErrorCode.CUSTOM_AGENT_A2A_PUBLISH_FAILED);
    }

    await this.agentModel
      .findByIdAndUpdate(agentId, {
        $set: {
          a2aPublished: true,
          a2aAgentId: result.agentId,
          a2aUrl: result.url,
          a2aAgentCardUrl: result.agentCardUrl,
          a2aApiKeyHeader: result.apiKeyHeader,
          a2aPublishedAt: new Date(),
        },
      })
      .exec();

    this.logger.log('Agent published over A2A', {
      agentId,
      userId,
      a2aAgentId: result.agentId,
    });

    return result;
  }

  /**
   * Rotate the API key for an already-published agent. Returns the new key once.
   */
  async rotateKey(userId: string, agentId: string): Promise<RotateKeyResult> {
    const agent = await this.loadOwnedPersonalAgent(userId, agentId);

    if (!agent.a2aPublished || !agent.a2aAgentId) {
      throw new ConflictException(ErrorCode.CUSTOM_AGENT_A2A_NOT_PUBLISHED);
    }

    const result = await this.grpcClient.rotateKey(agent.a2aAgentId);

    await this.agentModel
      .findByIdAndUpdate(agentId, {
        $set: { a2aApiKeyHeader: result.apiKeyHeader },
      })
      .exec();

    this.logger.log('A2A API key rotated', {
      agentId,
      userId,
      a2aAgentId: agent.a2aAgentId,
    });

    return result;
  }

  /**
   * Fetch an agent and assert the caller owns it and it is a personal (non-default)
   * agent. Mirrors the ownership guards in {@link AgentService}.
   */
  private async loadOwnedPersonalAgent(
    userId: string,
    agentId: string,
  ): Promise<AgentDocument> {
    if (!Types.ObjectId.isValid(agentId)) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    const agent = await this.agentModel.findById(agentId).exec();
    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }
    if (agent.isDefault) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY);
    }
    if (agent.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
    }

    return agent;
  }
}
