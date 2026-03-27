import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';

// Multer file interface
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
import { WorkspaceDocumentService } from './workspace-document.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { WorkspaceOwnerGuard } from './guards/workspace-owner.guard';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { InitiateBulkUploadDto } from './dto/initiate-bulk-upload.dto';
import { ReportProgressDto } from './dto/report-progress.dto';
import { DocumentQueryDto } from './dto/document-query.dto';
import { BulkDeleteDocumentsDto } from './dto/bulk-delete-documents.dto';

@ApiTags('Workspace Documents')
@Controller('workspaces/:workspaceId/documents')
@ApiBearerAuth()
@UseGuards(WorkspaceOwnerGuard)
export class WorkspaceDocumentController {
  constructor(
    private readonly workspaceDocumentService: WorkspaceDocumentService,
  ) {}

  /**
   * Upload a small file directly (multipart/form-data)
   */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a small file directly (< 10MB recommended)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiResponse({ status: 201, description: 'Document uploaded successfully' })
  async uploadSmallFile(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @UploadedFile() file: MulterFile,
  ) {
    return this.workspaceDocumentService.uploadSmallFile(
      workspaceId,
      user._id.toString(),
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }

  /**
   * Request presigned URL for large file upload
   */
  @Post('upload-url')
  @ApiOperation({ summary: 'Get presigned URL for large file upload' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiResponse({ status: 201, description: 'Upload URL generated' })
  async requestUploadUrl(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: RequestUploadUrlDto,
  ) {
    return this.workspaceDocumentService.requestUploadUrl(
      workspaceId,
      user._id.toString(),
      dto,
    );
  }

  /**
   * Confirm upload completed (for presigned URL uploads)
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm upload completed' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  async confirmUpload(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: ConfirmUploadDto,
  ) {
    return this.workspaceDocumentService.confirmUpload(
      workspaceId,
      user._id.toString(),
      dto.documentId,
    );
  }

  /**
   * Initiate bulk upload session
   */
  @Post('bulk')
  @ApiOperation({ summary: 'Initiate bulk upload session' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiResponse({ status: 201, description: 'Bulk upload session created' })
  async initiateBulkUpload(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: InitiateBulkUploadDto,
  ) {
    return this.workspaceDocumentService.initiateBulkUpload(
      workspaceId,
      user._id.toString(),
      dto,
    );
  }

  /**
   * Report progress for bulk upload
   */
  @Post('bulk/:sessionId/progress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report upload progress for a file in bulk session' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiParam({ name: 'sessionId', description: 'Upload session ID' })
  async reportProgress(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: ReportProgressDto,
  ) {
    await this.workspaceDocumentService.reportProgress(
      workspaceId,
      user._id.toString(),
      sessionId,
      dto,
    );
    return { success: true };
  }

  /**
   * Complete bulk upload session
   */
  @Post('bulk/:sessionId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete bulk upload session' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiParam({ name: 'sessionId', description: 'Upload session ID' })
  async completeBulkUpload(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.workspaceDocumentService.completeBulkUpload(
      workspaceId,
      user._id.toString(),
      sessionId,
    );
  }

  /**
   * Get bulk upload session status
   */
  @Get('bulk/:sessionId')
  @ApiOperation({ summary: 'Get bulk upload session status' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiParam({ name: 'sessionId', description: 'Upload session ID' })
  async getUploadSession(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.workspaceDocumentService.getUploadSession(
      workspaceId,
      user._id.toString(),
      sessionId,
    );
  }

  /**
   * List documents in workspace
   */
  @Get()
  @ApiOperation({ summary: 'List documents in workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  async findAll(
    @Param('workspaceId') workspaceId: string,
    @Query() query: DocumentQueryDto,
  ) {
    return this.workspaceDocumentService.findAllByWorkspace(workspaceId, query);
  }

  /**
   * Get document metadata
   */
  @Get(':docId')
  @ApiOperation({ summary: 'Get document metadata' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiParam({ name: 'docId', description: 'Document ID' })
  async findOne(
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
  ) {
    return this.workspaceDocumentService.findById(workspaceId, docId);
  }

  /**
   * Get download URL for document
   */
  @Get(':docId/download-url')
  @ApiOperation({ summary: 'Get presigned download URL for document' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiParam({ name: 'docId', description: 'Document ID' })
  async getDownloadUrl(
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
  ) {
    return this.workspaceDocumentService.getDownloadUrl(workspaceId, docId);
  }

  /**
   * Delete all documents in workspace
   * NOTE: This route MUST come before :docId routes to avoid "all" being captured as a document ID
   */
  @Delete('all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete all documents in workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  async deleteAll(
    @Param('workspaceId') workspaceId: string,
  ) {
    await this.workspaceDocumentService.deleteAllByWorkspace(workspaceId);
    return { message: 'All documents deleted successfully' };
  }

  /**
   * Bulk delete documents
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk delete documents' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  async bulkDelete(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: BulkDeleteDocumentsDto,
  ) {
    return this.workspaceDocumentService.bulkDelete(
      workspaceId,
      user._id.toString(),
      dto.documentIds,
    );
  }

  /**
   * Delete a single document
   */
  @Delete(':docId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a document' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiParam({ name: 'docId', description: 'Document ID' })
  async delete(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
  ) {
    await this.workspaceDocumentService.delete(
      workspaceId,
      user._id.toString(),
      docId,
    );
    return { message: 'Document deleted successfully' };
  }
}
