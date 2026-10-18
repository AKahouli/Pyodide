import { Injectable, Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from '@modules/document/document.service';
import { BadRequestException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { FlowAccessService } from '../domain/flow-access.service';
import { ExecutionRepository } from '../persistence/execution.repository';
import { TaskResultRepository } from '../persistence/task-result.repository';
import { publicPlaybookTaskResult, trustedPlaybookArtifacts } from '../utils/playbook-artifact';
import type { PlaybookArtifactAction } from '../dto/request-playbook-artifact-access.dto';
import { randomBytes } from 'crypto';
import { PlaybookShareService } from './playbook-share.service';
import { McpJwtService, AdkExecutionAuthority } from '@modules/connector/services/mcp-jwt.service';
import { ExecutionLeaseRepository } from '../persistence/execution-lease.repository';
import { UserService } from '@modules/user/user.service';
import { assertAccountApproved } from '@modules/user/utils/assert-account-accessible';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { hasPermission, Permissions } from '@modules/authorization/constants/permissions';

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
    private readonly executionRepository: ExecutionRepository,
    private readonly taskResultRepository: TaskResultRepository,
    private readonly accessService: FlowAccessService,
    private readonly documentService: DocumentService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly playbookShareService: PlaybookShareService,
    @Optional() private readonly executionSigner?: McpJwtService,
    @Optional() private readonly executionLeases?: ExecutionLeaseRepository,
    @Optional() private readonly users?: UserService,
    @Optional() private readonly authorization?: AuthorizationService,
  ) {}

  async issuePublicationAuthority(executionId: string, ownerId: string): Promise<string> {
    const execution = await this.executionRepository.findOwned(executionId, ownerId);
    const generation = execution?.startedAt && await this.executionLeases?.authorityGeneration(executionId, ownerId, execution.flowId);
    if (!execution || execution.status !== 'running' || !generation || !this.executionSigner) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid artifact execution authority');
    }
    const claims: AdkExecutionAuthority = { purpose: 'playbook-artifact', executionId, sub: ownerId,
      flowId: execution.flowId, dispatchStartedAt: execution.startedAt!.toISOString(), generation };
    const token = this.executionSigner.issueAdkExecutionAuthority(claims);
    await this.assertPublicationAuthority(token, executionId, ownerId);
    return token;
  }

  async assertPublicationAuthority(token: string | undefined, executionId: string, ownerId?: string, renewal = false): Promise<AdkExecutionAuthority> {
    if (!this.executionSigner || !this.users || !this.authorization || !this.executionLeases) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Artifact execution authority unavailable');
    }
    const claims = this.executionSigner.verifyAdkExecutionAuthority(token, 'playbook-artifact');
    if (claims.executionId !== executionId || ownerId !== undefined && ownerId !== claims.sub) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Artifact execution authority mismatch');
    }
    const execution = await this.executionRepository.findOwned(executionId, claims.sub);
    const generation = execution && await this.executionLeases.authorityGeneration(executionId, claims.sub, execution.flowId);
    if (!execution || !(execution.status === 'running' || renewal && execution.status === 'pending_approval') || !generation || generation !== claims.generation
      || execution.flowId !== claims.flowId || execution.startedAt?.toISOString() !== claims.dispatchStartedAt) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Stale artifact execution authority');
    }
    const user = await this.users.findById(claims.sub);
    if (!user) throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Artifact actor unavailable');
    assertAccountApproved(user);
    const roles = await this.authorization.getUserRoles(claims.sub);
    const permissions = await this.authorization.getUserPermissions(roles.map(role => role.id));
    if (!hasPermission(permissions, Permissions.PLAYBOOK_EXECUTE)) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Artifact actor permission revoked');
    }
    await this.accessService.assertExecutionAccess(execution.flowId, claims.sub, 'read');
    return claims;
  }

  async renewPublicationAuthority(token: string | undefined, executionId: string): Promise<{ token: string }> {
    const claims = await this.assertPublicationAuthority(token, executionId, undefined, true);
    return { token: this.executionSigner!.issueAdkExecutionAuthority(claims) };
  }

  async listRecent(userId: string, limit: number): Promise<{
    source: 'playbook';
    artifactId: string;
    filename: string;
    artifactKind: string;
    mimeType?: string;
    playbookId: string;
    playbookName: string;
    executionId: string;
    generatedAt: string;
  }[]> {
    const sharedFlowIds = await this.playbookShareService.getSharedPlaybookIdsForUser(userId);
    const rows = await this.taskResultRepository.listRecentArtifacts(userId, sharedFlowIds, limit);

    return rows.flatMap(({ flowId: playbookId, flowName: playbookName, executionId, executionOwnerId, executionUpdatedAt, taskResult, generatedAt }) => {
      const generated = (generatedAt ?? executionUpdatedAt ?? new Date()).toISOString();
      return trustedPlaybookArtifacts(taskResult as unknown as Record<string, unknown>, executionOwnerId, executionId).map((artifact) => ({
          source: 'playbook' as const,
          artifactId: artifact.artifactId,
          filename: artifact.filename,
          artifactKind: artifact.artifactKind,
          mimeType: artifact.mimeType || undefined,
          playbookId,
          playbookName,
          executionId,
          generatedAt: generated,
        }));
    }).slice(0, limit);
  }

  async publishArtifact(
    executionId: string,
    ownerId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    authority?: string,
  ): Promise<{ artifactId: string; filename: string; mimeType: string; size: number }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Artifact file is required');
    }
    if (file.buffer.length > PLAYBOOK_ARTIFACT_MAX_BYTES) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Artifact exceeds the 10 MB publication limit');
    }
    await this.assertPublicationAuthority(authority, executionId, ownerId);
    const execution = await this.executionRepository.findOwned(executionId, ownerId);
    if (execution?.status !== 'running') {
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
    const execution = await this.executionRepository.findById(executionId);
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
    const execution = await this.executionRepository.findById(capability.executionId);
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
    redactSensitiveText = true,
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
    return publicPlaybookTaskResult(taskResult, ownerId, executionId, verifiedArtifactIds, redactSensitiveText);
  }

  private async resolveArtifact(executionId: string, artifactId: string, ownerId: string) {
    const taskResults = await this.taskResultRepository.listForExecution(executionId, { light: true, with: ['components'] });
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
