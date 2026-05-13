import { ApiProperty } from '@nestjs/swagger';
import {
  PaginatedShares,
  ShareWorkspaceResult,
  WorkspacePermission,
  WorkspaceShareResponse,
} from '../interfaces/workspace-share.interface';

class SharedUserInfoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ required: false })
  firstName?: string;

  @ApiProperty({ required: false })
  lastName?: string;
}

export class WorkspaceShareResponseDto implements WorkspaceShareResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  workspaceId!: string;

  @ApiProperty({ type: () => SharedUserInfoDto })
  user!: SharedUserInfoDto;

  @ApiProperty({ enum: ['read', 'readwrite'] })
  permission!: WorkspacePermission;

  @ApiProperty()
  sharedBy!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

class PaginationMetaDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class PaginatedSharesDto implements PaginatedShares {
  @ApiProperty({ type: () => [WorkspaceShareResponseDto] })
  shares!: WorkspaceShareResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class ShareWorkspaceResultDto implements ShareWorkspaceResult {
  @ApiProperty({ type: () => [WorkspaceShareResponseDto] })
  shared!: WorkspaceShareResponseDto[];

  @ApiProperty({ type: [String] })
  notFound!: string[];

  @ApiProperty({ type: [String] })
  invalid!: string[];
}
