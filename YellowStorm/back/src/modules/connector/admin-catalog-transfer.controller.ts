import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions, hasPermission } from '../authorization/constants/permissions';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { RateLimit } from '../rate-limiter';
import { UserDocument } from '../user/schemas/user.schema';
import { ExportCatalogDto, ImportCatalogDto } from './dto/catalog-transfer.dto';
import { CatalogTransferService } from './services/catalog-transfer.service';

interface MulterFile {
  originalname: string;
  buffer: Buffer;
}

@ApiTags('Admin Catalog Transfer')
@ApiBearerAuth()
@Controller('admin/catalog-transfer')
@UseGuards(PermissionsGuard)
export class AdminCatalogTransferController {
  constructor(
    private readonly transferService: CatalogTransferService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post('connectors/export')
  @RequirePermissions(Permissions.CONNECTORS_READ)
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'admin:catalog:connector-export' })
  @ApiOperation({ summary: 'Export selected or all connectors with linked skills' })
  async exportConnectors(
    @Body() dto: ExportCatalogDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.assertSecurityPermission(user, Boolean(dto.includeSecurity));
    const result = await this.transferService.exportConnectors(user._id.toString(), dto);
    this.audit(user, req, 'connectors.catalog_export', {
      selection: dto.selection,
      selectedCount: dto.ids?.length ?? null,
      securityIncluded: result.securityIncluded,
    });
    this.sendArchive(res, result.filename, result.buffer);
  }

  @Post('skills/export')
  @RequirePermissions(Permissions.SKILLS_READ)
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'admin:catalog:skill-export' })
  @ApiOperation({ summary: 'Export selected or all skills with complete catalog properties' })
  async exportSkills(
    @Body() dto: ExportCatalogDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.transferService.exportSkills(user._id.toString(), dto);
    this.audit(user, req, 'skills.catalog_export', {
      selection: dto.selection,
      selectedCount: dto.ids?.length ?? null,
    });
    this.sendArchive(res, result.filename, result.buffer);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'admin:catalog:import' })
  @ApiOperation({ summary: 'Import a connector or skill catalog archive' })
  async importCatalog(
    @UploadedFile() file: MulterFile,
    @Body() dto: ImportCatalogDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    const archive = this.transferService.parseArchive(file?.buffer ?? Buffer.alloc(0), dto.passphrase);
    this.assertSecurityPermission(user, archive.securityIncluded);
    this.assertImportPermissions(user, archive, dto.conflictPolicy ?? 'skip');
    const result = await this.transferService.importArchive(
      user._id.toString(),
      archive,
      dto.conflictPolicy ?? 'skip',
    );
    this.audit(user, req, `${archive.resource}.catalog_import`, {
      conflictPolicy: dto.conflictPolicy ?? 'skip',
      securityIncluded: archive.securityIncluded,
      result,
    });
    return result;
  }

  private assertSecurityPermission(user: UserDocument, required: boolean): void {
    if (!required) return;
    const permissions = ((user as unknown as { permissions?: string[] }).permissions ?? []);
    if (!hasPermission(permissions, Permissions.CONNECTORS_TRANSFER_SECURITY)) {
      throw new ForbiddenException(ErrorCode.PERMISSION_DENIED);
    }
  }

  private assertImportPermissions(
    user: UserDocument,
    archive: {
      connectors: unknown[];
      skills: unknown[];
      connectorCategories: unknown[];
      skillCategories: unknown[];
    },
    conflictPolicy: 'skip' | 'overwrite',
  ): void {
    const permissions = ((user as unknown as { permissions?: string[] }).permissions ?? []);
    const required: string[] = [];
    if (archive.connectors.length || archive.connectorCategories.length) {
      required.push(Permissions.CONNECTORS_CREATE);
      if (conflictPolicy === 'overwrite') required.push(Permissions.CONNECTORS_UPDATE);
    }
    if (archive.skills.length || archive.skillCategories.length) {
      required.push(Permissions.SKILLS_CREATE);
      if (conflictPolicy === 'overwrite') required.push(Permissions.SKILLS_UPDATE);
    }
    if (required.some((permission) => !hasPermission(permissions, permission))) {
      throw new ForbiddenException(ErrorCode.PERMISSION_DENIED);
    }
  }

  private sendArchive(res: Response, filename: string, buffer: Buffer): void {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  private audit(
    user: UserDocument,
    req: Request,
    action: string,
    metadata: Record<string, unknown>,
  ): void {
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action,
      targetType: 'CatalogArchive',
      metadata,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
