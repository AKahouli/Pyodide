import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StopPlaybookDto {
  @ApiProperty({ description: 'The execution ID to stop' })
  @IsString()
  @IsNotEmpty()
  executionId!: string;
}
