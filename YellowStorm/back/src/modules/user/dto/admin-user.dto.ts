import { IsString, IsOptional, IsNumber, Min, Max, IsEnum } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { UserStatus } from '../schemas/user.schema';

export class AdminListUsersQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Search by email or name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by status', enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Filter by email verified status' })
  @IsOptional()
  @Type(() => Boolean)
  emailVerified?: boolean;

  @ApiPropertyOptional({ description: 'Filter by profile complete status' })
  @IsOptional()
  @Type(() => Boolean)
  profileComplete?: boolean;

  @ApiPropertyOptional({ description: 'Sort field', default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ description: 'Sort order', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class AssignPlanDto {
  @ApiProperty({ description: 'Plan ID to assign' })
  @IsString()
  planId!: string;
}

export interface AdminUserResponse {
  id: string;
  email: string;
  emailVerified: boolean;
  profileComplete: boolean;
  profile: {
    firstName?: string;
    lastName?: string;
    company?: string;
  };
  status: UserStatus;
  plan?: {
    id: string;
    slug: string;
    startedAt?: Date;
  };
  roles: {
    id: string;
    name: string;
  }[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

export interface AdminUserListResponse {
  users: AdminUserResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
