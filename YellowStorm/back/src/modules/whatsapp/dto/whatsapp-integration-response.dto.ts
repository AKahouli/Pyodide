import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WhatsAppIntegrationResponseDto {
  @ApiProperty({ enum: ['PAIRING', 'CONNECTED', 'DISCONNECTED', 'FAILED'], example: 'CONNECTED' })
  status!: 'PAIRING' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED';

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440000' })
  sessionId?: string;

  @ApiPropertyOptional({ example: '+21612345678' })
  phoneNumber?: string;

  @ApiPropertyOptional({
    description: 'Admin-configured phone that must be used when pairing the system bot',
    example: '55555555555',
  })
  expectedPairingPhone?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  displayName?: string;

  @ApiPropertyOptional({ example: '2026-06-04T12:00:00.000Z' })
  lastActivityAt?: string;

  @ApiPropertyOptional({ example: 'Pairing timed out' })
  errorMessage?: string;

  @ApiPropertyOptional({ example: '2026-06-04T12:00:00.000Z' })
  updatedAt?: string;
}
