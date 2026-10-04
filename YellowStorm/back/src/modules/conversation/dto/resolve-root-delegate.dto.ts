import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Authority comes from the persisted root execution, never model arguments. */
export class ResolveRootDelegateDto {
  @ApiProperty() @Matches(/^[0-9a-f]{24}$/) agentId!: string;
  @ApiProperty() @IsString() @MaxLength(256) nativeCallId!: string;
  @ApiProperty() @IsString() @MaxLength(2048) nativeCallBranch!: string;
  @ApiProperty() @IsString() @MaxLength(50000) task!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) expectedOutput?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(256, { each: true }) contextRefs?: string[];
}
