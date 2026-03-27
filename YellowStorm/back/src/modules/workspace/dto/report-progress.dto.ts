import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsIn, IsOptional, IsString, Min, Max, MaxLength } from 'class-validator';

export class ReportProgressDto {
  @ApiProperty({ description: 'Index of the file in the bulk upload', example: 0 })
  @IsNumber()
  @Min(0)
  fileIndex!: number;

  @ApiProperty({ description: 'Upload progress percentage', example: 50, minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  progress!: number;

  @ApiProperty({ description: 'Upload status', enum: ['uploading', 'completed', 'failed'] })
  @IsIn(['uploading', 'completed', 'failed'])
  status!: 'uploading' | 'completed' | 'failed';

  @ApiPropertyOptional({ description: 'Error message if status is failed', maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  error?: string;
}
