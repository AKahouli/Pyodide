import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DesignPlaybookDto {
  @ApiProperty({ minLength: 5, maxLength: 5000, description: 'Query describing the desired changes to the playbook' })
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  query!: string;
}
