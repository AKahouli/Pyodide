import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for `POST /worky/interactions/{id}/respond`. `content` is the
 * raw owner answer; if the original `WorkyInteraction.options` was a
 * fixed list the response is a free-text echo. `cancel` flag allows the
 * owner to dismiss the interaction without answering. For
 * `type=approval` interactions the `approve` flag carries the verdict
 * (the runtime uses it to bind the gated tool or trigger replan).
 */
export class RespondWorkyInteractionDto {
  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;

  @ApiPropertyOptional({ description: 'If true, mark the interaction as canceled instead of answered' })
  @IsOptional()
  cancel?: boolean;

  @ApiPropertyOptional({
    description: 'Approval verdict — only meaningful when the interaction type is "approval"',
  })
  @IsOptional()
  approve?: boolean;
}
