import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from './schemas/user.schema';
import { UserResponse } from './interfaces/user.interface';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  async getProfile(@CurrentUser() user: UserDocument): Promise<UserResponse> {
    return this.mapUserToResponse(user);
  }

  @Put('me')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  async updateProfile(
    @CurrentUser() user: UserDocument,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponse> {
    // Only include defined properties to avoid overwriting with undefined
    const profile: { firstName?: string; lastName?: string; company?: string } = {};
    if (dto.firstName !== undefined) profile.firstName = dto.firstName;
    if (dto.lastName !== undefined) profile.lastName = dto.lastName;
    if (dto.company !== undefined) profile.company = dto.company;

    const consents: { privacyPolicy?: boolean; dataSharing?: boolean } = {};
    if (dto.privacyPolicy !== undefined) consents.privacyPolicy = dto.privacyPolicy;
    if (dto.dataSharing !== undefined) consents.dataSharing = dto.dataSharing;

    const updatedUser = await this.userService.updateProfile(user._id.toString(), {
      profile: Object.keys(profile).length > 0 ? profile : undefined,
      consents: Object.keys(consents).length > 0 ? consents : undefined,
    });
    return this.mapUserToResponse(updatedUser);
  }

  @Post('me/complete-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete user profile with required fields' })
  @ApiResponse({ status: 200, description: 'Profile completed successfully' })
  @ApiResponse({ status: 400, description: 'Privacy policy must be accepted' })
  async completeProfile(
    @CurrentUser() user: UserDocument,
    @Body() dto: CompleteProfileDto,
  ): Promise<UserResponse> {
    const updatedUser = await this.userService.completeProfile(user._id.toString(), {
      firstName: dto.firstName,
      lastName: dto.lastName,
      company: dto.company,
      privacyPolicy: dto.privacyPolicy,
      dataSharing: dto.dataSharing,
    });

    return this.mapUserToResponse(updatedUser);
  }

  /**
   * Map UserDocument to UserResponse
   */
  private mapUserToResponse(user: UserDocument): UserResponse {
    // permissions and roleNames are attached to user by JwtStrategy from JWT payload
    const userWithPermissions = user as unknown as {
      permissions?: string[];
      roleNames?: string[];
    };

    return {
      id: user._id.toString(),
      email: user.email,
      emailVerified: user.emailVerified,
      profileComplete: user.profileComplete,
      profile: {
        firstName: user.profile?.firstName,
        lastName: user.profile?.lastName,
        company: user.profile?.company,
      },
      consents: {
        privacyPolicy: user.consents?.privacyPolicy,
        privacyPolicyAcceptedAt: user.consents?.privacyPolicyAcceptedAt,
        dataSharing: user.consents?.dataSharing,
        dataSharingAcceptedAt: user.consents?.dataSharingAcceptedAt,
      },
      plan: user.planId
        ? {
            id: user.planId.toString(),
            slug: user.planSlug,
            startedAt: user.planStartedAt,
          }
        : undefined,
      status: user.status,
      permissions: userWithPermissions.permissions,
      roleNames: userWithPermissions.roleNames,
    };
  }
}
