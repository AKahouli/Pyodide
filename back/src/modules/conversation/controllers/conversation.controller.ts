import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ConversationService } from '../services/conversation.service';
import { CreateConversationDto } from '../dto/create-conversation.dto';
import { UpdateConversationDto } from '../dto/update-conversation.dto';
import { ConversationQueryDto } from '../dto/conversation-query.dto';
import { DocumentQueryDto } from '../../workspace/dto/document-query.dto';
import { ConversationOwnerGuard } from '../guards/conversation-owner.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { DocumentService } from '../../document/document.service';
import { ServiceUnavailableException, BadRequestException } from '../../exceptions';

@ApiTags('Conversations')
@Controller('conversations')
@ApiBearerAuth()
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly documentService: DocumentService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: { _id: string },
    @Body() dto: CreateConversationDto,
  ) {
    return this.conversationService.create(user._id.toString(), dto);
  }

  @Post('artifact-url')
  async getArtifactDownloadUrl(
    @Body() body: { filePath: string; filename?: string },
  ) {
    if (!body.filePath) {
      throw new BadRequestException('File path is required');
    }

    if (!this.documentService.isAvailable()) {
      throw new ServiceUnavailableException(
        undefined,
        'Document service is currently unavailable',
      );
    }

    const contentDisposition = body.filename
      ? `attachment; filename="${body.filename}"`
      : undefined;

    const downloadUrl = await this.documentService.generateSasUrl(body.filePath, {
      expiryMinutes: 60,
      contentDisposition,
      checkExists: true,
    });

    return { downloadUrl };
  }

  @Get()
  async findAll(
    @CurrentUser() user: { _id: string },
    @Query() query: ConversationQueryDto,
  ) {
    return this.conversationService.findAllByUser(user._id.toString(), query);
  }

  @Get(':id')
  @UseGuards(ConversationOwnerGuard)
  async findOne(@Param('id') id: string) {
    return this.conversationService.findById(id);
  }

  @Post(':id/join')
  @UseGuards(ConversationOwnerGuard)
  async join(
    @CurrentUser() user: { _id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.conversationService.joinGroup(id, user._id.toString(), user.email);
  }

  @Delete(':id/members/:memberId')
  @UseGuards(ConversationOwnerGuard)
  async removeMember(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.conversationService.removeMember(id, user._id.toString(), memberId);
  }

  @Patch(':id/members/:memberId/job')
  @UseGuards(ConversationOwnerGuard)
  async updateMemberJob(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body('job') job: string,
  ) {
    return this.conversationService.updateMemberJob(id, user._id.toString(), memberId, job);
  }

  @Patch(':id')
  @UseGuards(ConversationOwnerGuard)
  async update(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversationService.update(id, user._id.toString(), dto);
  }

  @Get(':id/workspace-documents')
  @UseGuards(ConversationOwnerGuard)
  async getWorkspaceDocuments(
    @Param('id') id: string,
    @Query() query: DocumentQueryDto,
  ) {
    return this.conversationService.getWorkspaceDocuments(id, query);
  }

  @Get(':id/tagged-agents')
  @UseGuards(ConversationOwnerGuard)
  async getTaggedAgents(@Param('id') id: string) {
    return this.conversationService.getTaggedAgents(id);
  }

  @Patch(':id/mentions/:messageId/seen')
  @UseGuards(ConversationOwnerGuard)
  async markMentionSeen(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    await this.conversationService.markMentionSeen(id, user._id.toString(), messageId);
    return { success: true };
  }

  @Delete(':id')
  @UseGuards(ConversationOwnerGuard)
  async delete(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
  ) {
    await this.conversationService.delete(id, user._id.toString());
    return { deleted: true };
  }
}
