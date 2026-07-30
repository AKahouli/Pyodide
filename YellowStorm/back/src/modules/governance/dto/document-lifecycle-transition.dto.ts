import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DocumentLifecycleTransitionDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) commandId!: string;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}
