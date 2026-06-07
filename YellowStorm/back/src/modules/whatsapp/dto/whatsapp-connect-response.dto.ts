import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WhatsAppConnectResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  sessionId!: string;

  @ApiProperty({ enum: ['PAIRING'], example: 'PAIRING' })
  status!: 'PAIRING';

  @ApiPropertyOptional({ description: 'Base64 PNG or data URL for QR scanning' })
  qrCode?: string;

  @ApiPropertyOptional({ example: '12345678' })
  pairingCode?: string;
}
