import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from '@modules/document/document.service';
import { BadRequestException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { FlowAccessService } from '../domain/flow-access.service';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../schemas/playbook-flow-task-result.schema';
import { publicPlaybookTaskResult, trustedPlaybookArtifacts } from '../utils/playbook-artifact';
import type { PlaybookArtifactAction } from '../dto/request-playbook-artifact-access.dto';
import { randomBytes } from 'crypto';

const ARTIFACT_AUDIENCE = 'yellostorm-playbook-artifact';
const ARTIFACT_TOKEN_TYPE = 'playbook-artifact';
const ARTIFACT_ACCESS_SECONDS = 10 * 60;
export const PLAYBOOK_ARTIFACT_MAX_BYTES = 10 * 1024 * 1024;

interface ArtifactCapability {
  type: typeof ARTIFACT_TOKEN_TYPE;
  executionId: string;
  artifactId: string;
  action: PlaybookArtifactAction;
}

@Injectable()
export class PlaybookFlowArtifactService {
  private readonly logger = new Logger(PlaybookFlowArtifactService.name);

  constructor(
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name) private readonly taskResultModel: Model<FlowTaskResultDocument>,
    private readonly accessService: FlowAccessService,
    private readonly documentService: DocumentService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async publishArtifact(
    executionId: string,
    ownerId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
  ): Promise<{ artifactId: string; filename: string; mimeType: string; size: number }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Artifact file is required');
    }
    if (file.buffer.length > PLAYBOOK_ARTIFACT_MAX_BYTES) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Artifact exceeds the 10 MB publication limit');
    }
    const execution = await this.executionModel
      .findOne({ _id: executionId, ownerId, status: 'running' })
      .select('_id')
      .lean()
      .exec();
    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Running execution not found');
    }
    if (!this.documentService.isAvailable()) {
      throw new ServiceUnavailableException(undefined, 'Document service is currently unavailable');
    }

    const artifactId = randomBytes(16).toString('hex');
    const folder = `${ownerId}/system_${executionId}/artifacts`;
    const storagePath = `${folder}/${artifactId}`;
    const uploaded = await this.documentService.upload(file.buffer, file.originalname, file.mimetype, {
      folder,
      generateUniqueName: false,
      customFileName: artifactId,
      metadata: { executionId, artifactId },
    });
    if (uploaded.blobPath !== storagePath || !(await this.documentService.exists(storagePath))) {
      throw new ServiceUnavailableException(undefined, 'Artifact storage verification failed');
    }
    this.logger.log('Playbook artifact published', {
      executionId,
      artifactId,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
    });
    return {
      artifactId,
      filename: uploaded.originalName,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
    };
  }

  async issueAccess(
    executionId: string,
    artifactId: string,
    userId: string,
    action: PlaybookArtifactAction,
  ): Promise<{ token: string; expiresAt: string }> {
    const execution = await this.executionModel.findById(executionId).select('ownerId flowId').lean().exec();
    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    }
    if (String(execution.ownerId) !== String(userId)) {
      await this.accessService.assertExecutionAccess(String(execution.flowId), userId, 'read');
    }
    if (!this.documentService.isAvailable()) {
      throw new ServiceUnavailableException(undefined, 'Document service is currently unavailable');
    }
    const artifact = await this.resolveArtifact(executionId, artifactId, String(execution.ownerId));
    if (!(await this.documentService.exists(artifact.storagePath))) {
      throw new NotFoundException(ErrorCode.WORKSPACE_DOCUMENT_NOT_IN_BLOB, 'Artifact file not found in storage');
    }
    const token = await this.jwtService.signAsync(
      { type: ARTIFACT_TOKEN_TYPE, executionId, artifactId, action } satisfies ArtifactCapability,
      {
        secret: this.configService.get<string>('jwt.secret'),
        issuer: this.configService.get<string>('jwt.issuer'),
        audience: ARTIFACT_AUDIENCE,
        expiresIn: ARTIFACT_ACCESS_SECONDS,
      },
    );
    return { token, expiresAt: new Date(Date.now() + ARTIFACT_ACCESS_SECONDS * 1000).toISOString() };
  }

  async openContent(token: string, range?: string) {
    const capability = await this.verifyCapability(token);
    if (!this.documentService.isAvailable()) {
      throw new ServiceUnavailableException(undefined, 'Document service is currently unavailable');
    }
    const execution = await this.executionModel.findById(capability.executionId).select('ownerId').lean().exec();
    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    }
    const artifact = await this.resolveArtifact(capability.executionId, capability.artifactId, String(execution.ownerId));
    return {
      action: capability.action,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      stream: await this.documentService.openReadStream(artifact.storagePath, range),
    };
  }

  async projectPublicTaskResult(
    taskResult: Record<string, unknown>,
    ownerId: string,
    executionId: string,
  ): Promise<Record<string, unknown>> {
    const trusted = trustedPlaybookArtifacts(taskResult, ownerId, executionId);
    const verifiedArtifactIds = new Set<string>();
    if (this.documentService.isAvailable() && trusted.length > 0) {
      const uniquePaths = [...new Set(trusted.map((artifact) => artifact.storagePath))];
      const checks = await Promise.allSettled(
        uniquePaths.map((storagePath) => this.documentService.exists(storagePath)),
      );
      const availablePaths = new Set(
        uniquePaths.filter((_path, index) => checks[index].status === 'fulfilled' && checks[index].value),
      );
      trusted.forEach((artifact) => {
        if (availablePaths.has(artifact.storagePath)) verifiedArtifactIds.add(artifact.artifactId);
      });
    }
    return publicPlaybookTaskResult(taskResult, ownerId, executionId, verifiedArtifactIds);
  }

  private async resolveArtifact(executionId: string, artifactId: string, ownerId: string) {
    const taskResults = await this.taskResultModel.find({ executionId }).select('taskId iteration components').lean().exec();
    const artifact = taskResults
      .flatMap((taskResult) => trustedPlaybookArtifacts(taskResult as unknown as Record<string, unknown>, ownerId, executionId))
      .find((candidate) => candidate.artifactId === artifactId);
    if (!artifact) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Artifact not found');
    }
    return artifact;
  }

  private async verifyCapability(token: string): Promise<ArtifactCapability> {
    try {
      const capability = await this.jwtService.verifyAsync<ArtifactCapability>(token, {
        secret: this.configService.get<string>('jwt.secret'),
        issuer: this.configService.get<string>('jwt.issuer'),
        audience: ARTIFACT_AUDIENCE,
      });
      if (
        capability.type !== ARTIFACT_TOKEN_TYPE
        || typeof capability.executionId !== 'string'
        || typeof capability.artifactId !== 'string'
        || (capability.action !== 'view' && capability.action !== 'download')
      ) {
        throw new Error('Invalid artifact capability');
      }
      return capability;
    } catch {
      throw new UnauthorizedException(ErrorCode.AUTH_TOKEN_INVALID, 'Invalid or expired artifact access');
    }
  }
}
