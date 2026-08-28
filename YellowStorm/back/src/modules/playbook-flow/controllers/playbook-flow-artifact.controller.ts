import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'stream/promises';
import { Public } from '@modules/auth/decorators/public.decorator';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { RateLimit } from '@modules/rate-limiter/decorators/rate-limit.decorator';
import { PlaybookFlowArtifactService } from '../services/playbook-flow-artifact.service';

@ApiTags('Playbook Flow Artifacts')
@Controller('executions/artifacts')
export class PlaybookFlowArtifactController {
  constructor(private readonly artifactService: PlaybookFlowArtifactService) {}

  @Get('content')
  @Public()
  @SkipResponseWrap()
  @RateLimit({ limit: 120, windowMs: 60000, keyPrefix: 'playbook-artifact:content' })
  @ApiOperation({ summary: 'Stream a playbook artifact through an application capability' })
  async content(
    @Query('token') token: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const artifact = await this.artifactService.openContent(token, range);
    const { stream } = artifact;
    const encodedFilename = encodeURIComponent(artifact.filename);
    response.status(stream.contentRange ? 206 : 200);
    response.setHeader('Content-Type', stream.contentType || artifact.mimeType || 'application/octet-stream');
    response.setHeader('Content-Disposition', `${artifact.action === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodedFilename}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (stream.contentLength !== undefined) response.setHeader('Content-Length', stream.contentLength);
    if (stream.contentRange) response.setHeader('Content-Range', stream.contentRange);
    if (stream.acceptRanges) response.setHeader('Accept-Ranges', stream.acceptRanges);
    let clientClosed = false;
    response.on('close', () => {
      clientClosed = true;
      if (!response.writableEnded) stream.body.destroy();
    });
    try {
      await pipeline(stream.body, response);
    } catch (error) {
      if (clientClosed || response.headersSent) {
        if (!response.destroyed) response.destroy(error as Error);
        return;
      }
      throw error;
    }
  }
}
