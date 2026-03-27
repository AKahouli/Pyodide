import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTaskReplayFormatDto {
  @ApiProperty({
    description: 'Whether replay synthesis should preserve the validated output format',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  preserveOutputFormat?: boolean;

  @ApiProperty({
    description: 'Editable format guide used during replay synthesis',
    required: false,
  })
  @IsString()
  @MaxLength(12000)
  @IsOptional()
  outputFormatGuide?: string;
}
