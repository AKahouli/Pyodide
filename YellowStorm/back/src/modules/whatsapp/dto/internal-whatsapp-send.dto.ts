import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class InternalWhatsAppSendDto {
  @ApiProperty({ description: 'Agent whose paired WhatsApp session sends the message' })
  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  agentId!: string;

  @ApiPropertyOptional({
    description: 'Recipient JID or E.164 phone. Defaults to the agent’s most recent known binding.',
    example: '21612345678@s.whatsapp.net',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  to?: string;

  @ApiProperty({ description: 'Message text (truncated to WHATSAPP_MAX_REPLY_LENGTH)', maxLength: 4096 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text!: string;
}
