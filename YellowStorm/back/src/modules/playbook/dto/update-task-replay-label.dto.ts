import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTaskReplayLabelDto {
  @ApiProperty({
    description: 'Custom display label for the replay baseline',
    required: false,
    maxLength: 100,
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  label?: string;
}
