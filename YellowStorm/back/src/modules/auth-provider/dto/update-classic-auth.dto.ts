import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateClassicAuthDto {
  @ApiPropertyOptional({ description: 'Enable/disable classic email+password auth' })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Allow new user registration' })
  @IsBoolean()
  @IsOptional()
  registrationEnabled?: boolean;
}
