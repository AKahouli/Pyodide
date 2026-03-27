import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsString,
  IsNumber,
  MaxLength,
  Min,
} from 'class-validator';

export class BulkUploadFileDto {
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

export class InitiateBulkUploadDto {
  @ApiProperty({
    description: 'Array of files to upload',
    type: [BulkUploadFileDto],
    minItems: 1,
    maxItems: 50,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Type(() => BulkUploadFileDto)
  files!: BulkUploadFileDto[];
}
