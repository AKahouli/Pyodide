import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ConversationV2TemplateCategoryService } from './services/conversation-v2-template-category.service';
import { ConversationV2TemplateService } from './services/conversation-v2-template.service';
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
}
