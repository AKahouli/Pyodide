import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for `POST /worky/streams/{id}/{pause|resume|stop}`. All fields are
 * optional; a reason is recorded on the audit log when supplied.
 */
export class WorkyStreamControlDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
