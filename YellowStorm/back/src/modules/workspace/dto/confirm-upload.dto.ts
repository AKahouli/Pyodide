import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsOptional } from 'class-validator';

export class ConfirmUploadDto {
  @ApiProperty({ description: 'Document ID to confirm upload for' })
  @IsMongoId()
  documentId!: string;

  @ApiPropertyOptional({ description: 'When true, index with deep research ingestion' })
  @IsOptional()
  @IsBoolean()
  deepSearch?: boolean;
}
