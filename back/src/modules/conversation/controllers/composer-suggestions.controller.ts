import { Body, Controller, Post, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../../rate-limiter';
import { ComposerSuggestionsDto } from '../dto/composer-suggestions.dto';
import { ComposerSuggestionsService } from '../services/composer-suggestions.service';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ComposerSuggestionsController {
  private readonly logger = new Logger(ComposerSuggestionsController.name);

  constructor(private readonly composerSuggestionsService: ComposerSuggestionsService) {}

  @Post('suggestions')
  @RateLimit({ limit: 60, windowMs: 60000, keyPrefix: 'conversation:suggestions' })
  @ApiOperation({ summary: 'Generate short composition suggestions from a partial message (ADK proxy)' })
  async composerSuggestions(@Body() dto: ComposerSuggestionsDto) {
    this.logger.log('Composer suggestions request received', {
      partialTextLength: dto.partialText?.length,
      partialTextPreview: dto.partialText?.substring(0, 50),
      agentId: dto.agentId,
      hasAgentId: !!dto.agentId,
    });
    return this.composerSuggestionsService.fetchSuggestions(dto.partialText, dto.agentId);
  }
}
