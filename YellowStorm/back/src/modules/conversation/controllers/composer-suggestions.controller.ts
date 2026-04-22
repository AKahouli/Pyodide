import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../../rate-limiter';
import { ComposerSuggestionsDto } from '../dto/composer-suggestions.dto';
import { ComposerSuggestionsService } from '../services/composer-suggestions.service';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ComposerSuggestionsController {
  constructor(private readonly composerSuggestionsService: ComposerSuggestionsService) {}

  @Post('suggestions')
  @RateLimit({ limit: 60, windowMs: 60000, keyPrefix: 'conversation:suggestions' })
  @ApiOperation({ summary: 'Generate short composition suggestions from a partial message (ADK proxy)' })
  async composerSuggestions(@Body() dto: ComposerSuggestionsDto) {
    return this.composerSuggestionsService.fetchSuggestions(dto.partialText, dto.agentId);
  }
}
