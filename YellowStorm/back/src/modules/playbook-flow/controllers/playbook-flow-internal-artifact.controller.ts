import {
  Controller,
  Headers,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import {
  multipartFileInterceptorOptions,
} from '@common/utils/multipart-limits';
import {
  PLAYBOOK_ARTIFACT_MAX_BYTES,
  PlaybookFlowArtifactService,
} from '../services/playbook-flow-artifact.service';

@Public()
@ApiTags('Playbook Artifacts Internal')
@Controller({ path: 'internal/playbook-artifacts', version: VERSION_NEUTRAL })
@UseGuards(InternalServiceGuard)
export class PlaybookFlowInternalArtifactController {
  constructor(private readonly artifactService: PlaybookFlowArtifactService) {}

  @Post('executions/:executionId')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Publish a generated Playbook artifact into platform storage' })
  @UseInterceptors(
    FileInterceptor('file', multipartFileInterceptorOptions(PLAYBOOK_ARTIFACT_MAX_BYTES)),
  )
  publish(
    @Param('executionId') executionId: string,
    @Headers('x-yellowstorm-user-id') ownerId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
  ) {
    return this.artifactService.publishArtifact(executionId, ownerId, file);
  }
}
