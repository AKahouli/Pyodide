import { IsString, Matches, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateTeamDto {
  @ApiProperty({ description: 'Team name (alphanumeric and spaces)', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9 ]+$/, { message: 'Name must contain only letters, numbers, and spaces' })
  name!: string;

  @ApiProperty({ description: 'Natural language prompt describing desired team structure', minLength: 10, maxLength: 10000 })
  @IsString()
  @MinLength(10)
  @MaxLength(10000)
  prompt!: string;
}
