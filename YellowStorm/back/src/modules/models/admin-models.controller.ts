import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ModelsService } from './models.service';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { Permissions } from '../authorization/constants/permissions';
import { UpdateModelDto } from './dto/update-model.dto';
import { NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { ModelResponse, ModelsListResponse } from './interfaces/model.interface';

@ApiTags('Admin Models')
@ApiBearerAuth()
@Controller('admin/models')
@UseGuards(PermissionsGuard)
export class AdminModelsController {
  constructor(
    private readonly modelsService: ModelsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.MODELS_READ_ALL)
  @ApiOperation({ summary: 'List all models (including inactive)' })
  @ApiResponse({ status: 200, description: 'Models retrieved' })
  async listAllModels(): Promise<ModelsListResponse> {
    // include inactive (activeOnly=false) AND all types (chatOnly=false)
    return this.modelsService.findAll(false, false);
  }

  @Get('default')
  @RequirePermissions(Permissions.MODELS_READ_ALL)
  @ApiOperation({ summary: 'Get the default model' })
  @ApiResponse({ status: 200, description: 'Default model retrieved' })
  async getDefaultModel(): Promise<ModelResponse | null> {
    return this.modelsService.getDefaultModel();
  }

  @Patch(':id')
  @RequirePermissions(Permissions.MODELS_UPDATE)
  @ApiOperation({ summary: 'Update a model' })
  @ApiParam({ name: 'id', description: 'Model ID (e.g., gpt-4o)' })
  @ApiResponse({ status: 200, description: 'Model updated' })
  @ApiResponse({ status: 404, description: 'Model not found' })
  async updateModel(
    @Param('id') id: string,
    @Body() dto: UpdateModelDto,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ): Promise<ModelResponse> {
    const model = await this.modelsService.updateModel(id, dto);

    if (!model) {
      throw new NotFoundException(ErrorCode.MODEL_NOT_FOUND);
    }

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'models.update',
      targetId: id,
      targetType: 'Model',
      metadata: { changes: dto },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return model;
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.MODELS_SET_DEFAULT)
  @ApiOperation({ summary: 'Set a model as the default' })
  @ApiParam({ name: 'id', description: 'Model ID (e.g., gpt-4o)' })
  @ApiResponse({ status: 200, description: 'Model set as default' })
  @ApiResponse({ status: 404, description: 'Model not found' })
  async setDefaultModel(
    @Param('id') id: string,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ): Promise<ModelResponse> {
    const model = await this.modelsService.setDefaultModel(id);

    if (!model) {
      throw new NotFoundException(ErrorCode.MODEL_NOT_FOUND);
    }

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'models.set_default',
      targetId: id,
      targetType: 'Model',
      metadata: { modelName: model.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return model;
  }

  @Post(':id/clear-default')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.MODELS_SET_DEFAULT)
  @ApiOperation({ summary: 'Clear default status from a model' })
  @ApiParam({ name: 'id', description: 'Model ID (e.g., gpt-4o)' })
  @ApiResponse({ status: 200, description: 'Default status cleared' })
  @ApiResponse({ status: 404, description: 'Model not found' })
  async clearDefaultModel(
    @Param('id') id: string,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ): Promise<ModelResponse> {
    const model = await this.modelsService.clearDefaultModel(id);

    if (!model) {
      throw new NotFoundException(ErrorCode.MODEL_NOT_FOUND);
    }

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'models.clear_default',
      targetId: id,
      targetType: 'Model',
      metadata: { modelName: model.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return model;
  }

  @Post(':id/set-conversation-v2-default')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.MODELS_SET_DEFAULT)
  @ApiOperation({ summary: 'Set a model as the conversation-v2 default' })
  @ApiParam({ name: 'id', description: 'Model ID (e.g., gpt-4o)' })
  @ApiResponse({ status: 200, description: 'Model set as conversation-v2 default' })
  @ApiResponse({ status: 404, description: 'Model not found' })
  async setConversationV2DefaultModel(
    @Param('id') id: string,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ): Promise<ModelResponse> {
    const model = await this.modelsService.setConversationV2DefaultModel(id);

    if (!model) {
      throw new NotFoundException(ErrorCode.MODEL_NOT_FOUND);
    }

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'models.set_conversation_v2_default',
      targetId: id,
      targetType: 'Model',
      metadata: { modelName: model.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return model;
  }

  @Post(':id/clear-conversation-v2-default')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.MODELS_SET_DEFAULT)
  @ApiOperation({ summary: 'Clear conversation-v2 default status from a model' })
  @ApiParam({ name: 'id', description: 'Model ID (e.g., gpt-4o)' })
  @ApiResponse({ status: 200, description: 'Conversation-v2 default status cleared' })
  @ApiResponse({ status: 404, description: 'Model not found' })
  async clearConversationV2DefaultModel(
    @Param('id') id: string,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ): Promise<ModelResponse> {
    const model = await this.modelsService.clearConversationV2DefaultModel(id);

    if (!model) {
      throw new NotFoundException(ErrorCode.MODEL_NOT_FOUND);
    }

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'models.clear_conversation_v2_default',
      targetId: id,
      targetType: 'Model',
      metadata: { modelName: model.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return model;
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.MODELS_UPDATE)
  @ApiOperation({ summary: 'Sync models from LiteLLM' })
  @ApiResponse({ status: 200, description: 'Models synced' })
  async syncModels(
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ): Promise<{ added: number; reactivated: number; deactivated: number; total: number }> {
    const result = await this.modelsService.syncModels();

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'models.sync',
      targetType: 'Model',
      metadata: result,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }
}
