import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DesignPlaybookDto {
  @ApiProperty({ minLength: 5, maxLength: 20000, description: 'Query describing the desired changes to the playbook' })
  @IsString()
  @MinLength(5)
  @MaxLength(20000)
  query!: string;
}
