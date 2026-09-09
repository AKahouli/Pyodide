import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for `POST /worky/streams/{id}/messages`. The role is fixed to
 * `owner` at the controller layer; the runtime tag (a future
 * system-message kind) is not exposed to clients.
 *
 * Per-turn model overrides are accepted here: omitting a field means
 * "use the stream's persistent selection" (which itself falls back
 * to the admin default). The resolved LiteLLM identifier is what
 * gets forwarded to the runtime.
 */
export class CreateWorkyMessageDto {
  @ApiProperty({ maxLength: 50000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  content!: string;

  @ApiPropertyOptional({ description: 'Client-generated id used to correlate this turn with Electric updates.' })
  @IsOptional()
  @IsUUID()
  turnId?: string;

  @ApiPropertyOptional({
    description:
      'Per-turn override for the Manager model. LiteLLM identifier (e.g. `gpt-4o-mini`). Omit = use stream persistent field / admin default.',
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  managerModelId?: string;

  @ApiPropertyOptional({
    description:
      'Per-turn override for ephemeral worker models. LiteLLM identifier. Omit = use stream persistent field / admin default.',
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  workerModelId?: string;
}
