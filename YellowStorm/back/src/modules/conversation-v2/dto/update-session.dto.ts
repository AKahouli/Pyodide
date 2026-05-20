import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSessionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isShared?: boolean;
}
