import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class ConfirmUploadDto {
  @ApiProperty({ description: 'Document ID to confirm upload for' })
  @IsMongoId()
  documentId!: string;
}
