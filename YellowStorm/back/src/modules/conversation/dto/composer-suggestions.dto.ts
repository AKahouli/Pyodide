import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ComposerSuggestionsDto {
  @ApiProperty({
    description: 'Partial message draft used to generate composition suggestions',
    minLength: 3,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  partialText!: string;
}
