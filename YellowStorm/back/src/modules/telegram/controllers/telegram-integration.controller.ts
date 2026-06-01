import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { TelegramIntegrationService } from '../services/telegram-integration.service';
import { UpsertAgentTelegramIntegrationDto } from '../dto/upsert-agent-telegram-integration.dto';
import {
  TelegramIntegrationResponseDto,
  TelegramLinkCodeResponseDto,
} from '../dto/telegram-integration-response.dto';
import { TelegramLinkCodeService } from '../services/telegram-link-code.service';

@ApiTags('Agent Telegram Integration')
@ApiBearerAuth()
@Controller('agents/:agentId/telegram-integration')
export class TelegramIntegrationController {
  constructor(
    private readonly integrationService: TelegramIntegrationService,
    private readonly linkCodeService: TelegramLinkCodeService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get Telegram integration settings for an agent' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  @ApiResponse({ status: 200, type: TelegramIntegrationResponseDto })
  async getIntegration(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
  ): Promise<TelegramIntegrationResponseDto | null> {
    return this.integrationService.getByAgentForUser(user._id.toString(), agentId);
  }

  @Put()
  @ApiOperation({ summary: 'Create or update Telegram integration settings for an agent' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  @ApiResponse({ status: 200, type: TelegramIntegrationResponseDto })
  async upsertIntegration(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
    @Body() dto: UpsertAgentTelegramIntegrationDto,
  ): Promise<TelegramIntegrationResponseDto> {
    return this.integrationService.upsertForAgent(user._id.toString(), agentId, dto);
  }

  @Post('webhook/register')
  @ApiOperation({ summary: 'Register Telegram webhook for this agent integration' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  @HttpCode(HttpStatus.OK)
  async registerWebhook(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
  ): Promise<{ registered: true }> {
    await this.integrationService.registerWebhookForAgent(user._id.toString(), agentId);
    return { registered: true };
  }

  @Post('link-code')
  @ApiOperation({ summary: 'Generate a short-lived Telegram link code for /start <code>' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  @ApiResponse({ status: 200, type: TelegramLinkCodeResponseDto })
  async generateLinkCode(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
  ): Promise<TelegramLinkCodeResponseDto> {
    const integration = await this.integrationService.getDocumentByAgentForUser(
      user._id.toString(),
      agentId,
    );
    return this.linkCodeService.generateForIntegration(integration);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete Telegram integration settings for this agent' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  async deleteIntegration(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
  ): Promise<void> {
    await this.integrationService.deleteForAgent(user._id.toString(), agentId);
  }
}
