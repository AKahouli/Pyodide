import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkyTtsService } from '../services/worky-tts.service';
import { SpeakWorkyTtsDto } from '../dto/speak-worky-tts.dto';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';

/**
 * Voice-reply endpoint: turns an agent answer into spoken audio via OpenRouter
 * (see `WorkyTtsService`). Returns raw audio bytes the browser plays.
 */
@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky/tts')
export class WorkyTtsController {
  constructor(private readonly tts: WorkyTtsService) {}

  @Post('speak')
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Synthesize speech (EN/FR) from agent answer text' })
  async speak(@Body() dto: SpeakWorkyTtsDto, @Res() res: Response): Promise<void> {
    const { audio, contentType } = await this.tts.speak(dto.text, dto.voice);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', audio.length);
    res.send(audio);
  }
}
