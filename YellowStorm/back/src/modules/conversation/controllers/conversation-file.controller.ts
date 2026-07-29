import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { decodeMultipartFilename } from '@common/utils';
import { ConversationService } from '../services/conversation.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import {
  RequestConversationFileUploadUrlDto,
  ConfirmConversationFileUploadDto,
} from '../dto/conversation-file.dto';
import { ConversationOwnerGuard } from '../guards/conversation-owner.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { LoggerService } from '../../logger';
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
@ApiTags('Conversation Files')
@Controller('conversations/:conversationId/files')
@ApiBearerAuth()
@UseGuards(ConversationOwnerGuard)
export class ConversationFileController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('ConversationFileController');
  }

  @Post('upload-url')
  async requestUploadUrl(
    @CurrentUser() user: { _id: string },
    @Param('conversationId') conversationId: string,
    @Body() dto: RequestConversationFileUploadUrlDto,
  ) {
    const userId = user._id.toString();

    this.logger.log('Requesting file upload URL', {
      conversationId,
      filename: dto.filename,
      mimeType: dto.mimeType,
      size: dto.size,
    });

    const workspaceId = await this.conversationService.ensureSystemWorkspace(
      userId,
      conversationId,
    );

    const pathPrefix = `${userId}/${conversationId}`;

    return this.workspaceDocumentService.requestUploadUrlWithPath(
      workspaceId,
      userId,
      { filename: dto.filename, mimeType: dto.mimeType, size: dto.size },
      pathPrefix,
    );
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSmallFile(
    @CurrentUser() user: { _id: string },
    @Param('conversationId') conversationId: string,
    @UploadedFile() file: MulterFile,
  ) {
    // multer decodes the multipart filename as latin1; restore the real UTF-8 name.
    file.originalname = decodeMultipartFilename(file.originalname);
    const userId = user._id.toString();
    this.logger.log('Direct file upload', {
      conversationId,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    });
    const workspaceId = await this.conversationService.ensureSystemWorkspace(
      userId,
      conversationId,
    );

    const pathPrefix = `${userId}/${conversationId}`;

    return this.workspaceDocumentService.uploadSmallFileWithPath(
      workspaceId,
      userId,
      file.buffer,
      file.originalname,
      file.mimetype,
      pathPrefix,
    );
  }

  @Post('confirm')
  async confirmUpload(
    @CurrentUser() user: { _id: string },
    @Param('conversationId') conversationId: string,
    @Body() dto: ConfirmConversationFileUploadDto,
  ) {
    const userId = user._id.toString();

    this.logger.log('Confirming file upload', {
      conversationId,
      documentId: dto.documentId,
    });

    const workspaceId = await this.conversationService.ensureSystemWorkspace(
      userId,
      conversationId,
    );

    return this.workspaceDocumentService.confirmUpload(
      workspaceId,
      userId,
      dto.documentId,
    );
  }

  @Delete(':documentId')
  async deleteFile(
    @CurrentUser() user: { _id: string },
    @Param('conversationId') conversationId: string,
    @Param('documentId') documentId: string,
  ) {
    const userId = user._id.toString();

    this.logger.log('Deleting conversation file', {
      conversationId,
      documentId,
    });

    const workspaceId = await this.conversationService.ensureSystemWorkspace(
      userId,
      conversationId,
    );

    await this.workspaceDocumentService.delete(workspaceId, userId, documentId);

    return { message: 'File deleted' };
  }
}
