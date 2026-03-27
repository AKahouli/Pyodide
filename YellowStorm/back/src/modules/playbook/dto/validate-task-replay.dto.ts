import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateTaskReplayDto {
  @ApiProperty({ description: 'Execution ID used as the replay baseline' })
  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @ApiProperty({
    description: 'Preserve the validated output format during replay synthesis',
    required: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  preserveOutputFormat?: boolean;
}
