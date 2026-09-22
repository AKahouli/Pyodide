import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserGroupService } from './user-group.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { CreateUserGroupDto, UpdateUserGroupDto, AddMembersDto } from './dto';
import { IUserGroupResponse } from './interfaces/user-group.interface';

@ApiTags('User Groups')
@ApiBearerAuth()
@Controller('user-groups')
export class UserGroupController {
  constructor(private readonly userGroupService: UserGroupService) {}

  @Get()
  @ApiOperation({ summary: 'List the current user groups' })
  async findAll(@CurrentUser() user: AuthUser): Promise<IUserGroupResponse[]> {
    return this.userGroupService.findAllForUser(user._id.toString());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a group by id (with populated members)' })
  async findById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<IUserGroupResponse> {
    return this.userGroupService.findById(user._id.toString(), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a group' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUserGroupDto,
  ): Promise<IUserGroupResponse> {
    return this.userGroupService.create(user._id.toString(), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a group name/description' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserGroupDto,
  ): Promise<IUserGroupResponse> {
    return this.userGroupService.update(user._id.toString(), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a group' })
  async delete(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.userGroupService.delete(user._id.toString(), id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add members to a group' })
  async addMembers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddMembersDto,
  ): Promise<IUserGroupResponse> {
    return this.userGroupService.addMembers(user._id.toString(), id, dto.userIds);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member from a group' })
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') memberId: string,
  ): Promise<IUserGroupResponse> {
    return this.userGroupService.removeMember(user._id.toString(), id, memberId);
  }
}
