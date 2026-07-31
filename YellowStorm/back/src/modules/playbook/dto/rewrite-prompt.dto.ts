import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RewritePromptDto {
  @ApiProperty({ minLength: 1, maxLength: 20000, description: 'Prompt to rewrite' })
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  prompt!: string;
}
