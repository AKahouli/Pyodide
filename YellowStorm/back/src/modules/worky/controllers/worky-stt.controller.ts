import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkySttService } from '../services/worky-stt.service';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Voice composer endpoint: accepts a recorded clip and returns its transcript
 * so the Worky owner can speak (rather than type) their plan to the Manager.
 * The transcription runs on OpenRouter's Whisper; see `WorkySttService`.
 */
@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky/stt')
export class WorkySttController {
  constructor(
    private readonly stt: WorkySttService,
    private readonly config: ConfigService,
  ) {}

  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Transcribe a recorded audio clip (EN/FR) to text' })
  @UseInterceptors(FileInterceptor('file'))
  async transcribe(
    @UploadedFile() file: MulterFile,
  ): Promise<{ text: string; language?: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No audio file uploaded.');
    }
    const maxBytes = this.config.get<number>('worky.sttMaxBytes') ?? 26214400;
    if (file.size > maxBytes) {
      throw new UnprocessableEntityException(
        `Audio clip too large (max ${Math.floor(maxBytes / 1024 / 1024)}MB).`,
      );
    }
    if (file.mimetype && !file.mimetype.startsWith('audio/')) {
      throw new UnprocessableEntityException('Uploaded file is not audio.');
    }
    return this.stt.transcribe(file.buffer, file.mimetype);
  }
}
