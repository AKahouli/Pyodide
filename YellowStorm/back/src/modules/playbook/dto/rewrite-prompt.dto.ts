import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RewritePromptDto {
  @ApiProperty({ minLength: 1, maxLength: 5000, description: 'Prompt to rewrite' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  prompt!: string;
}
