import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Query params for the public third-party agents endpoint. All filters are
 * optional, case-insensitive substring matches, and AND-combined. The agent
 * type ("humain") is fixed by the endpoint and cannot be overridden here.
 */
export class PublicQueryAgentDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by role (substring, case-insensitive)' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ description: 'Filter by agent name (substring, case-insensitive)' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Filter by description (substring, case-insensitive)' })
  @IsOptional()
  @IsString()
  description?: string;
}
