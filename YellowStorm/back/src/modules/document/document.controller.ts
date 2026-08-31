import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { DocumentService } from './document.service';
import { DownloadUrlRequestDto } from './dto/download-url.dto';

/**
 * Internal, service-to-service endpoint that hands external services a
 * presigned URL to download any file in Ceph by its object key.
 *
 * Authenticated with the shared X-Internal-Token header (INTERNAL_SERVICE_SECRET)
 * via {@link InternalServiceGuard}; @Public bypasses the global JwtAuthGuard.
 */
@Public()
@UseGuards(InternalServiceGuard)
@ApiTags('Internal Documents')
@ApiSecurity('internal-token')
@Controller('internal/documents')
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly configService: ConfigService,
  ) {}

  @Post('download-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a presigned download URL for a Ceph file path' })
  @ApiResponse({ status: 200, description: 'Signed download URL generated' })
  @ApiResponse({ status: 404, description: 'File not found in storage' })
  async getDownloadUrl(@Body() dto: DownloadUrlRequestDto) {
    const url = await this.documentService.generateSasUrl(dto.filePath, {
      checkExists: true,
      allowExtensionless: true,
      expiryMinutes: dto.expiryMinutes,
    });

    const expiresInMinutes =
      dto.expiryMinutes ?? this.configService.get<number>('storage.sasExpiryMinutes', 60);

    return { url, filePath: dto.filePath, expiresInMinutes };
  }
}
