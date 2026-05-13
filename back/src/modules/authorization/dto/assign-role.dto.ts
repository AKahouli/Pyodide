import { IsString, IsMongoId } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignRoleDto {
  @ApiProperty({
    description: 'ID of the role to assign',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  @IsMongoId()
  roleId!: string;
}

export class AssignRoleToUserDto {
  @ApiProperty({
    description: 'ID of the user to assign the role to',
    example: '507f1f77bcf86cd799439012',
  })
  @IsString()
  @IsMongoId()
  userId!: string;

  @ApiProperty({
    description: 'ID of the role to assign',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  @IsMongoId()
  roleId!: string;
}
