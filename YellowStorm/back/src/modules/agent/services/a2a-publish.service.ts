import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { stripTrailingChar } from '@common/utils';
import { Agent, AgentDocument } from '../schemas/agent.schema';
import { AgentService } from '../agent.service';
import { A2AAdminGrpcClientService } from './a2a-admin.grpc-client.service';
import {
  ChatbotAgentInput,
  PublishAgentResult,
  RevokeAgentResult,
  RotateKeyResult,
} from '../types/a2a-admin.types';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

/**
 * Application service that publishes a personal agent over the A2A protocol,
 * rotates its API key, and revokes it. It bridges the persisted Agent document
 * (ownership + gRPC-agent assembly via {@link AgentService}) with the A2A admin
 * gRPC client.
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
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(A2APublishService.name);
  }

  /**
   * The gRPC service returns the agent-card path relative to the A2A serving
   * surface (it already starts with `/`). Prepend `API_ADK_URL` so callers get
   * an absolute, reachable URL. Falls back to the relative path if unset.
   */
  private toAbsoluteCardUrl(cardPath: string): string {
    const base = stripTrailingChar(this.config.get<string>('a2aAdmin.apiAdkUrl', ''), '/');
    if (!base || !cardPath) return cardPath;
    return `${base}${cardPath}`;
  }

  /**
   * Publish (or re-publish) the agent over A2A. Builds the full gRPC agent
   * definition, hands it to the A2A admin service, and persists the returned
   * non-secret metadata. The API key is returned to the caller once and never
   * stored.
   */
  async publish(userId: string, agentId: string, canManageDefault = false): Promise<PublishAgentResult> {
    const agent = await this.loadManagedAgent(userId, agentId, canManageDefault);

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

    const agentCardUrl = this.toAbsoluteCardUrl(result.agentCardUrl);

    await this.agentModel
      .findByIdAndUpdate(agentId, {
        $set: {
          a2aPublished: true,
          a2aAgentId: result.agentId,
          a2aAgentCardUrl: agentCardUrl,
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

    return { ...result, agentCardUrl };
  }

  /**
   * Rotate the API key for an already-published agent. Returns the new key (and
   * the agent-card URL so the UI can re-display it) once.
   */
  async rotateKey(userId: string, agentId: string, canManageDefault = false): Promise<RotateKeyResult> {
    const agent = await this.loadManagedAgent(userId, agentId, canManageDefault);

    if (!agent.a2aPublished || !agent.a2aAgentId) {
      throw new ConflictException(ErrorCode.CUSTOM_AGENT_A2A_NOT_PUBLISHED);
    }

    const result = await this.grpcClient.rotateKey(agent.a2aAgentId);
    const agentCardUrl = this.toAbsoluteCardUrl(result.agentCardUrl);

    await this.agentModel
      .findByIdAndUpdate(agentId, {
        $set: {
          a2aApiKeyHeader: result.apiKeyHeader,
          a2aAgentCardUrl: agentCardUrl,
        },
      })
      .exec();

    this.logger.log('A2A API key rotated', {
      agentId,
      userId,
      a2aAgentId: agent.a2aAgentId,
    });

    return { ...result, agentCardUrl };
  }

  /**
   * Revoke a published agent: the A2A card and message endpoint stop serving.
   * Clears the local publish state so the UI offers "publish" again.
   */
  async revokeAgent(userId: string, agentId: string, canManageDefault = false): Promise<RevokeAgentResult> {
    const agent = await this.loadManagedAgent(userId, agentId, canManageDefault);

    if (!agent.a2aPublished || !agent.a2aAgentId) {
      throw new ConflictException(ErrorCode.CUSTOM_AGENT_A2A_NOT_PUBLISHED);
    }

    const result = await this.grpcClient.revokeAgent(agent.a2aAgentId);

    await this.agentModel
      .findByIdAndUpdate(agentId, {
        $set: { a2aPublished: false },
        $unset: {
          a2aAgentId: '',
          a2aAgentCardUrl: '',
          a2aApiKeyHeader: '',
          a2aPublishedAt: '',
        },
      })
      .exec();

    this.logger.log('Agent revoked from A2A', {
      agentId,
      userId,
      a2aAgentId: agent.a2aAgentId,
    });

    return result;
  }

  /**
   * The route guard has already validated default-agent management permission.
   * Preserve personal ownership validation for any direct service callers.
   */
  private async loadManagedAgent(
    userId: string,
    agentId: string,
    canManageDefault: boolean,
  ): Promise<AgentDocument> {
    if (!Types.ObjectId.isValid(agentId)) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    const agent = await this.agentModel.findById(agentId).exec();
    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }
    if (agent.isDefault && !canManageDefault) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY);
    }
    if (!agent.isDefault && agent.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
    }

    return agent;
  }
}
