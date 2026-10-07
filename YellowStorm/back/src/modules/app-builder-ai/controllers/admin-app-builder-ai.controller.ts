import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Permissions, PermissionsGuard, RequirePermissions } from '../../authorization';
import { AppBuilderAiAdminService } from '../services/app-builder-ai-admin.service';
import { AppBuilderAiOfferService } from '../services/app-builder-ai-offer.service';

class SetEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  offerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class CreateOfferDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsNumber()
  tokenLimit!: number;

  @IsInt()
  @Min(1)
  windowHours!: number;

  @IsOptional()
  @IsNumber()
  requestsPerMinute?: number;

  @IsOptional()
  @IsNumber()
  maxTokensPerRequest?: number;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsNumber()
  displayOrder?: number;
}

class UpdateOfferDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsNumber()
  tokenLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  windowHours?: number;

  @IsOptional()
  @IsNumber()
  requestsPerMinute?: number;

  @IsOptional()
  @IsNumber()
  maxTokensPerRequest?: number;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsNumber()
  displayOrder?: number;
}

class AssignOfferDto {
  @IsString()
  offerId!: string;
}

@ApiTags('Admin App Builder AI')
@ApiBearerAuth()
@Controller('admin/app-builder-ai')
@UseGuards(PermissionsGuard)
export class AdminAppBuilderAiController {
  constructor(
    private readonly admin: AppBuilderAiAdminService,
    private readonly offers: AppBuilderAiOfferService,
  ) {}

  @Get('overview')
  @RequirePermissions(Permissions.APP_BUILDER_AI_READ)
  getOverview() {
    return this.admin.getOverview();
  }

  @Put('enabled')
  @RequirePermissions(Permissions.APP_BUILDER_AI_MANAGE)
  setEnabled(@Body() body: SetEnabledDto) {
    return this.admin.setEnabled(body.enabled);
  }

  @Get('offers')
  @RequirePermissions(Permissions.APP_BUILDER_AI_READ)
  async listOffers() {
    const items = await this.offers.list(true);
    return {
      items: items.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        description: o.description,
        tokenLimit: o.tokenLimit,
        windowHours: o.windowHours,
        requestsPerMinute: o.requestsPerMinute,
        maxTokensPerRequest: o.maxTokensPerRequest,
        priority: o.priority,
        isActive: o.isActive,
        isDefault: o.isDefault,
        displayOrder: o.displayOrder,
      })),
    };
  }

  @Post('offers')
  @RequirePermissions(Permissions.APP_BUILDER_AI_MANAGE)
  async createOffer(@Body() body: CreateOfferDto) {
    const o = await this.offers.create(body);
    return { id: o.id, slug: o.slug, name: o.name };
  }

  @Put('offers/:id')
  @RequirePermissions(Permissions.APP_BUILDER_AI_MANAGE)
  async updateOffer(@Param('id') id: string, @Body() body: UpdateOfferDto) {
    const o = await this.offers.update(id, body);
    return { id: o.id, slug: o.slug, name: o.name };
  }

  @Delete('offers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.APP_BUILDER_AI_MANAGE)
  async deleteOffer(@Param('id') id: string): Promise<void> {
    await this.offers.remove(id);
  }

  @Get('users')
  @RequirePermissions(Permissions.APP_BUILDER_AI_READ)
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.admin.listUsers(query);
  }

  @Get('users/:id')
  @RequirePermissions(Permissions.APP_BUILDER_AI_READ)
  getUser(@Param('id') id: string) {
    return this.admin.getUserDetail(id);
  }

  @Get('users/:id/apps/:sessionId')
  @RequirePermissions(Permissions.APP_BUILDER_AI_READ)
  getUserApp(@Param('id') id: string, @Param('sessionId') sessionId: string) {
    return this.admin.getAppDetail(id, sessionId);
  }

  @Post('users/:id/assign-offer')
  @RequirePermissions(Permissions.APP_BUILDER_AI_MANAGE)
  assignOffer(@Param('id') id: string, @Body() body: AssignOfferDto) {
    return this.admin.assignOffer(id, body.offerId);
  }
}
