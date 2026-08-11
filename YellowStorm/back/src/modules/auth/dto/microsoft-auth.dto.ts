import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class MicrosoftAuthDto {
  @ApiProperty({
    description: 'Authorization code from Microsoft OAuth',
  })
  @IsString()
  code!: string;
}

export class MicrosoftAuthCallbackDto {
  @ApiProperty({
    description: 'Authorization code from Microsoft OAuth callback',
  })
  @IsString()
  code!: string;

  @ApiProperty({
    description: 'State parameter for CSRF protection',
    required: false,
  })
  @IsString()
  @IsOptional()
  state?: string;
}
