import { IsEmail, IsEnum } from 'class-validator';

export class CreateWorkyStreamShareDto {
  @IsEmail()
  email!: string;

  @IsEnum(['read', 'write'])
  permission!: 'read' | 'write';
}

export class UpdateWorkyStreamShareDto {
  @IsEnum(['read', 'write'])
  permission!: 'read' | 'write';
}
