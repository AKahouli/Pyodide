import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../authorization/constants/permissions';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { SkillCategoryService } from './skill-category.service';
import { CreateSkillCategoryDto } from './dto/create-skill-category.dto';
import { UpdateSkillCategoryDto } from './dto/update-skill-category.dto';
import { ISkillCategoryResponse } from './interfaces/skill.interface';

@ApiTags('Admin Skill Categories')
@ApiBearerAuth()
@Controller('admin/skill-categories')
@UseGuards(PermissionsGuard)
export class SkillCategoryController {
  constructor(
    private readonly categoryService: SkillCategoryService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.SKILLS_READ)
  @ApiOperation({ summary: 'List all skill categories' })
  async findAll(): Promise<ISkillCategoryResponse[]> {
    return this.categoryService.findAll();
  }

  @Get(':id')
  @RequirePermissions(Permissions.SKILLS_READ)
  @ApiOperation({ summary: 'Get a skill category by ID' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async findById(@Param('id') id: string): Promise<ISkillCategoryResponse> {
    return this.categoryService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.SKILLS_CREATE)
  @ApiOperation({ summary: 'Create a skill category' })
  async create(
    @Body() dto: CreateSkillCategoryDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<ISkillCategoryResponse> {
    const category = await this.categoryService.create(dto);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'skill_categories.create',
      targetId: category.id,
      targetType: 'SkillCategory',
      metadata: { name: category.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return category;
  }

  @Patch(':id')
  @RequirePermissions(Permissions.SKILLS_UPDATE)
  @ApiOperation({ summary: 'Update a skill category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSkillCategoryDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<ISkillCategoryResponse> {
    const category = await this.categoryService.update(id, dto);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'skill_categories.update',
      targetId: id,
      targetType: 'SkillCategory',
      metadata: { changes: Object.keys(dto) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return category;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.SKILLS_DELETE)
  @ApiOperation({ summary: 'Delete a skill category' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<void> {
    await this.categoryService.delete(id);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'skill_categories.delete',
      targetId: id,
      targetType: 'SkillCategory',
      metadata: {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
