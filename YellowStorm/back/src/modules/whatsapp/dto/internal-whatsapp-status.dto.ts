import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export class InternalWhatsAppStatusDto {
  @ApiProperty({ description: 'Agent whose WhatsApp integration status is requested' })
  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  agentId!: string;
}
