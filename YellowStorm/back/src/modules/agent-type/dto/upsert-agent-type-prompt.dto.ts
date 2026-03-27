import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertAgentTypePromptDto {
  @ApiProperty({ description: 'Prompt text for this model', maxLength: 50000 })
  @IsString()
  @MaxLength(50000)
  prompt!: string;
}
