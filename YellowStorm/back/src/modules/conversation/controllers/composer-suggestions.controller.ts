import { Body, Controller, Get, Post, Logger, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationSettingsService } from '../../system/conversation-settings.service';
import { ComposerSuggestionsDto } from '../dto/composer-suggestions.dto';
import { ComposerSuggestionsRateLimitGuard } from '../guards/composer-suggestions-rate-limit.guard';
import { ComposerSuggestionsService } from '../services/composer-suggestions.service';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ComposerSuggestionsController {
  private readonly logger = new Logger(ComposerSuggestionsController.name);

  constructor(
    private readonly composerSuggestionsService: ComposerSuggestionsService,
    private readonly conversationSettings: ConversationSettingsService,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get effective conversation runtime settings' })
  getSettings() {
    return this.conversationSettings.getSettings();
  }

  @Post('suggestions')
  @UseGuards(ComposerSuggestionsRateLimitGuard)
  @ApiOperation({ summary: 'Generate short composition suggestions from a partial message (ADK proxy)' })
  async composerSuggestions(@Body() dto: ComposerSuggestionsDto) {
    this.logger.log('Composer suggestions request received', {
      partialTextLength: dto.partialText?.length,
    });
    return this.composerSuggestionsService.fetchSuggestions(dto.partialText);
  }
}
