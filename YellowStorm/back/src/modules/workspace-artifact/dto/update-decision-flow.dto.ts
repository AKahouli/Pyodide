import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsString, Length, Min } from 'class-validator';

export class UpdateDecisionFlowDto {
  @ApiProperty() @IsInt() @Min(0) expectedRevision!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 150) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() payload?: Record<string, unknown>;
}
