import { ApiPropertyOptional } from '@nestjs/swagger';

export class WhatsAppPairingResponseDto {
  @ApiPropertyOptional({ description: 'Base64 PNG or data URL for QR scanning' })
  qrCode?: string;

  @ApiPropertyOptional({ example: '12345678' })
  pairingCode?: string;
}
