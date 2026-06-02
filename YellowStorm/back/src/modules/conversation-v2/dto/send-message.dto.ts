import { IsOptional, IsString, MaxLength, Matches, MinLength } from 'class-validator';

export class SendMessageQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(16384)
  message!: string;

  @IsOptional()
  @IsString()
  token?: string;

  /**
   * Optional full LiteLLM model identifier (e.g. "azure/gpt-4.1",
   * "anthropic/claude-sonnet-4-5"). Forwarded to the AI service via the
   * `model` field on the gRPC ChatRequest. When omitted, the AI service uses
   * its own default.
   */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  model?: string;

  /**
   * Client-generated UUID for the user `message` event. The frontend
   * optimistically renders the user's message under this id before the
   * backend writes the event; passing the same id lets the SSE-emitted
   * frame replace (upsert) the optimistic one instead of creating a
   * duplicate. Falls back to a server-generated UUID when omitted (legacy
   * clients).
   */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'clientEventId must be a UUID' })
  clientEventId?: string;

  @IsOptional()
  @IsString()
  connectorId?: string;

  @IsOptional()
  @IsString()
  connectorName?: string;

  @IsOptional()
  @IsString()
  connectorRepoId?: string;

  @IsOptional()
  @IsString()
  connectorRepoName?: string;

  @IsOptional()
  @IsString()
  connectorRepoUrl?: string;
}
