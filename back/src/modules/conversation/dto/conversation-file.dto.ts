import { IsString, IsNumber, IsMongoId, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestConversationFileUploadUrlDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  mimeType!: string;

  @ApiProperty({ minimum: 1 })
  @IsNumber()
  @Min(1)
  size!: number;
}

export class ConfirmConversationFileUploadDto {
  @ApiProperty()
  @IsMongoId()
  documentId!: string;
}
