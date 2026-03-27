import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class GrabOutputFormatTemplateDto {
  @ApiProperty({ description: 'Execution ID used as the source for the output format template' })
  @IsString()
  @IsNotEmpty()
  executionId!: string;
}
