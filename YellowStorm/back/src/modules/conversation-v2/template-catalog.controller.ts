import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { ConversationV2TemplateCategoryService } from './services/conversation-v2-template-category.service';
import { ConversationV2TemplateService } from './services/conversation-v2-template.service';
import { PresignRevisionDto } from './dto/presign-revision.dto';
import { TEMPLATE_CATALOG_PREVIEW_WORKSPACE_ID } from './constants/template-catalog.constants';
import {
  ITemplateCategoryResponse,
  ITemplateResponse,
} from './interfaces/template-catalog.interface';

/**
 * Read-only template gallery for regular users. "Using" a template happens via
 * `POST /conversation-v2/sessions { templateId }`, which seeds the session's
 * starter revision with the template manifest.
 */
@ApiTags('conversation-v2')
@ApiBearerAuth()
@Controller('conversation-v2/template-catalog')
export class TemplateCatalogController {
  constructor(
    private readonly categories: ConversationV2TemplateCategoryService,
    private readonly templates: ConversationV2TemplateService,
    private readonly runtimeRevisions: RuntimeRevisionService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
  ) {}

  @Get('categories')
  @ApiOperation({ summary: 'List template categories' })
  async listCategories(): Promise<ITemplateCategoryResponse[]> {
    return this.categories.findAll();
  }

  @Get('templates')
  @ApiOperation({ summary: 'List published templates, optionally filtered by category' })
  async listTemplates(@Query('categoryId') categoryId?: string): Promise<ITemplateResponse[]> {
    return this.templates.listPublished(categoryId);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Get a published template by ID' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async getTemplate(@Param('id') id: string): Promise<ITemplateResponse> {
    await this.templates.requirePublished(id);
    return this.templates.findById(id);
  }

  /**
   * List manifest files for a published template revision (App Market clone preview
   * before a Conversation V2 session exists).
   */
  @Get('templates/:id/preview/files')
  @ApiOperation({ summary: 'List files in a published template revision for browser preview' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async listTemplatePreviewFiles(
    @Param('id') id: string,
  ): Promise<{ revisionId: string; files: { path: string; sha256: string; size: number }[] }> {
    const revisionId = await this.requirePreviewRevisionId(id);
    const listed = await this.runtimeRevisions.listFiles(
      TEMPLATE_CATALOG_PREVIEW_WORKSPACE_ID,
      revisionId,
    );
    return {
      revisionId: listed.revisionId,
      files: listed.files.map(({ path, sha256, size }) => ({ path, sha256, size })),
    };
  }

  @Post('templates/:id/preview/presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Presign template revision blobs for browser preview hydration' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async presignTemplatePreviewFiles(
    @Param('id') id: string,
    @Body() body: PresignRevisionDto,
  ): Promise<{ items: { path: string; url: string }[] }> {
    const revisionId = await this.requirePreviewRevisionId(id);
    const revision = await this.runtimeRevisions.getAuthorizedRevision(
      TEMPLATE_CATALOG_PREVIEW_WORKSPACE_ID,
      revisionId,
    );
    const resolved = this.runtimeRevisions.resolveObjectKeys(revision, body.paths);
    const items: { path: string; url: string }[] = [];
    for (const file of resolved) {
      const url = await this.workspaceDocuments.generateReadUrl(file.objectKey, {
        allowExtensionless: true,
      });
      items.push({ path: file.path, url });
    }
    return { items };
  }

  /**
   * Published template row narrowed to its bound revision id. Kept in one place
   * because both preview endpoints need the same published + revision guard.
   */
  private async requirePreviewRevisionId(id: string): Promise<string> {
    const template = await this.templates.requirePublished(id);
    const revisionId = template.revisionId?.trim();
    if (!revisionId) {
      throw new NotFoundException(ErrorCode.CONVERSATION_V2_TEMPLATE_NOT_PUBLISHED);
    }
    return revisionId;
  }
}
