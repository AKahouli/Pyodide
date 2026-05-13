import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../authorization/constants/permissions';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { CreateSkillDto, QuerySkillDto, UpdateSkillDto } from './dto';
import { ISkillResponse } from './interfaces/skill.interface';
import { SkillService } from './skill.service';

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('Admin Skills')
@ApiBearerAuth()
@Controller('admin/skills')
@UseGuards(PermissionsGuard)
export class AdminSkillController {
  constructor(
    private readonly skillService: SkillService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.SKILLS_READ)
  @ApiOperation({ summary: 'List skills (paginated)' })
  async findAll(@Query() query: QuerySkillDto): Promise<PaginatedResponseDto<ISkillResponse>> {
    return this.skillService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(Permissions.SKILLS_READ)
  @ApiOperation({ summary: 'Get a skill by ID' })
  @ApiParam({ name: 'id', description: 'Skill ID' })
  async findById(@Param('id') id: string): Promise<ISkillResponse> {
    return this.skillService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.SKILLS_CREATE)
  @ApiOperation({ summary: 'Create a skill' })
  async create(
    @Body() dto: CreateSkillDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<ISkillResponse> {
    const skill = await this.skillService.create(user._id.toString(), dto);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'skills.create',
      targetId: skill.id,
      targetType: 'Skill',
      metadata: { skillName: skill.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return skill;
  }

  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.SKILLS_CREATE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Import a skill from SKILL.md or a zipped skill package' })
  async importSkill(
    @UploadedFile() file: MulterFile,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<ISkillResponse> {
    const skill = await this.skillService.importPackage(user._id.toString(), file);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'skills.import',
      targetId: skill.id,
      targetType: 'Skill',
      metadata: { skillName: skill.name, filename: file?.originalname },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return skill;
  }

  @Patch(':id')
  @RequirePermissions(Permissions.SKILLS_UPDATE)
  @ApiOperation({ summary: 'Update a skill' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSkillDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<ISkillResponse> {
    const skill = await this.skillService.update(id, dto);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'skills.update',
      targetId: skill.id,
      targetType: 'Skill',
      metadata: { skillName: skill.name, changes: dto },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return skill;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.SKILLS_DELETE)
  @ApiOperation({ summary: 'Delete a skill' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<void> {
    const skill = await this.skillService.findById(id);
    await this.skillService.delete(id);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'skills.delete',
      targetId: id,
      targetType: 'Skill',
      metadata: { skillName: skill.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
