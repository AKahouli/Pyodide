import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateWorkyWhatsAppSystemBotPhoneDto {
  @ApiProperty({
    description: 'Phone number for the system bot (digits only, optional + prefix)',
    example: '33753929093',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber!: string;
}
