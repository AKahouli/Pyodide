import {
  Controller,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { Public } from '../auth/decorators/public.decorator';
import { WorkspaceDocumentService } from './workspace-document.service';
import { IngestUrlDto } from './dto/ingest-url.dto';
import { Workspace, WorkspaceDocument } from './schemas/workspace.schema';
import { NotFoundException, ForbiddenException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';

@ApiTags('Workspace Ingest (Internal)')
@Controller('workspaces/:workspaceId/documents')
@UseGuards(InternalServiceGuard)
export class WorkspaceIngestController {
  constructor(
    private readonly workspaceDocService: WorkspaceDocumentService,
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
  ) {}

  @Public()
  @Post('ingest-url')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ingest a file from a download URL into a workspace (internal)' })
  @ApiParam({ name: 'workspaceId', description: 'Target workspace ID' })
  @ApiResponse({ status: 201, description: 'File ingested successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or download failed' })
  @ApiResponse({ status: 401, description: 'Invalid internal service token' })
  @ApiResponse({ status: 403, description: 'User does not own workspace or quota exceeded' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  async ingestFromUrl(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: IngestUrlDto,
  ) {
    if (!Types.ObjectId.isValid(workspaceId)) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Invalid workspace ID format',
      );
    }

    const workspace = await this.workspaceModel.findById(workspaceId).exec();
    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    if (workspace.createdBy.toString() !== dto.userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'User does not own this workspace',
      );
    }

    const document = await this.workspaceDocService.ingestFromUrl(workspaceId, dto);

    return {
      success: true,
      document,
    };
  }
}
