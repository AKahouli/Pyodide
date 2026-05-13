import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, MaxLength, Min } from 'class-validator';

export class RequestUploadUrlDto {
  @ApiProperty({ description: 'Original filename', example: 'document.pdf', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ description: 'File MIME type', example: 'application/pdf', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  mimeType!: string;

  @ApiProperty({ description: 'File size in bytes', example: 1048576 })
  @IsNumber()
  @Min(1)
  size!: number;
}
