import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateWhatsAppEnabledDto {
  @ApiProperty({
    description: 'Whether WhatsApp is enabled for this agent deployment',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;
}
