import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, RoleDocument } from './schemas/role.schema';
import { User } from '../user/schemas/user.schema';
import { LoggerService } from '../logger';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleResponse, DEFAULT_ROLES } from './interfaces/role.interface';
import { validatePermissions } from './constants/permissions';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class AuthorizationService implements OnApplicationBootstrap {
  private rolePermissionsCache: Map<string, string[]> = new Map(); // roleId -> permissions
  private roleNamesCache: Map<string, string> = new Map(); // roleId -> name
  private cacheLastUpdated: Date = new Date(0);

  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<typeof User>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AuthorizationService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    // Database is already connected via MongooseModule.forRootAsync()
    // which runs during module initialization before this hook
    try {
      await this.seedDefaultRoles();
      await this.refreshCache();
      this.logger.log('Authorization service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize authorization service', {
        error: (error as Error).message,
      });
    }
  }

  // ==================== Role Management ====================

  async createRole(dto: CreateRoleDto): Promise<RoleResponse> {
    // Validate permissions
    const validation = validatePermissions(dto.permissions);
    if (!validation.valid) {
      throw new BadRequestException(
        `Invalid permissions: ${validation.invalid.join(', ')}`,
      );
    }

    // Check for existing role with same name
    const existing = await this.roleModel.findOne({ name: dto.name.toLowerCase() });
    if (existing) {
      throw new ConflictException(ErrorCode.ROLE_ALREADY_EXISTS);
    }

    const role = await this.roleModel.create({
      name: dto.name.toLowerCase(),
      description: dto.description,
      permissions: dto.permissions,
      isActive: dto.isActive ?? true,
      isSystem: false, // User-created roles are never system roles
      priority: dto.priority ?? 0,
    });

    this.invalidateCache();

    this.logger.log('Role created', { roleId: role._id, name: role.name });

    return this.toRoleResponse(role);
  }

  async updateRole(id: string, dto: UpdateRoleDto): Promise<RoleResponse> {
    const role = await this.roleModel.findById(id);
    if (!role) {
      throw new NotFoundException(ErrorCode.ROLE_NOT_FOUND);
    }

    // Validate permissions if provided
    if (dto.permissions) {
      const validation = validatePermissions(dto.permissions);
      if (!validation.valid) {
        throw new BadRequestException(
          `Invalid permissions: ${validation.invalid.join(', ')}`,
        );
      }
    }

    // Check for name collision if name is being changed
    if (dto.name && dto.name.toLowerCase() !== role.name) {
      const existing = await this.roleModel.findOne({ name: dto.name.toLowerCase() });
      if (existing) {
        throw new ConflictException(ErrorCode.ROLE_ALREADY_EXISTS);
      }
    }

    // Update role (system roles are fully editable - seeding only creates if not exists)
    if (dto.name !== undefined) role.name = dto.name.toLowerCase();
    if (dto.description !== undefined) role.description = dto.description;
    if (dto.permissions !== undefined) role.permissions = dto.permissions;
    if (dto.isActive !== undefined) role.isActive = dto.isActive;
    if (dto.priority !== undefined) role.priority = dto.priority;

    await role.save();

    this.invalidateCache();

    this.logger.log('Role updated', { roleId: role._id, name: role.name, isSystem: role.isSystem });

    return this.toRoleResponse(role);
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.roleModel.findById(id);
    if (!role) {
      throw new NotFoundException(ErrorCode.ROLE_NOT_FOUND);
    }

    // System roles cannot be deleted
    if (role.isSystem) {
      throw new ForbiddenException(ErrorCode.ROLE_SYSTEM_PROTECTED);
    }

    // Remove role from all users
    await this.userModel.updateMany(
      { roles: new Types.ObjectId(id) },
      {
        $pull: { roles: new Types.ObjectId(id) },
        $inc: { permissionsVersion: 1 },
      },
    );

    await this.roleModel.deleteOne({ _id: id });

    this.invalidateCache();

    this.logger.log('Role deleted', { roleId: id, name: role.name });
  }

  async findAllRoles(): Promise<RoleResponse[]> {
    const roles = await this.roleModel.find().sort({ priority: -1, name: 1 });
    return roles.map((role) => this.toRoleResponse(role));
  }

  async findActiveRoles(): Promise<RoleResponse[]> {
    const roles = await this.roleModel.find({ isActive: true }).sort({ priority: -1, name: 1 });
    return roles.map((role) => this.toRoleResponse(role));
  }

  async findRoleById(id: string): Promise<RoleResponse> {
    const role = await this.roleModel.findById(id);
    if (!role) {
      throw new NotFoundException(ErrorCode.ROLE_NOT_FOUND);
    }
    return this.toRoleResponse(role);
  }

  async findRoleByName(name: string): Promise<RoleResponse | null> {
    const role = await this.roleModel.findOne({ name: name.toLowerCase() });
    return role ? this.toRoleResponse(role) : null;
  }

  // ==================== User Role Assignment ====================

  async assignRoleToUser(userId: string, roleId: string): Promise<void> {
    const role = await this.roleModel.findById(roleId);
    if (!role || !role.isActive) {
      throw new NotFoundException(ErrorCode.ROLE_NOT_FOUND);
    }

    await this.userModel.findByIdAndUpdate(userId, {
      $addToSet: { roles: new Types.ObjectId(roleId) },
      $inc: { permissionsVersion: 1 }, // Invalidate old JWTs on next refresh
    });

    this.logger.log('Role assigned to user', { userId, roleId, roleName: role.name });
  }

  async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $pull: { roles: new Types.ObjectId(roleId) },
      $inc: { permissionsVersion: 1 }, // Invalidate old JWTs on next refresh
    });

    this.logger.log('Role removed from user', { userId, roleId });
  }

  async getUserRoles(userId: string): Promise<RoleResponse[]> {
    const user = await this.userModel
      .findById(userId)
      .populate<{ roles: RoleDocument[] }>('roles')
      .lean();

    if (!user || !user.roles) {
      return [];
    }

    return user.roles
      .filter((role: RoleDocument) => role.isActive)
      .map((role: RoleDocument) => this.toRoleResponse(role));
  }

  // ==================== Permission Resolution ====================

  /**
   * Gets all permissions for a user by expanding their roles.
   * Uses cached role→permissions mapping for performance.
   */
  async getUserPermissions(roleIds: Types.ObjectId[]): Promise<string[]> {
    if (this.isCacheStale()) {
      await this.refreshCache();
    }

    const permissions = new Set<string>();
    for (const roleId of roleIds) {
      const rolePerms = this.rolePermissionsCache.get(roleId.toString());
      if (rolePerms) {
        rolePerms.forEach((p) => permissions.add(p));
      }
    }
    return Array.from(permissions);
  }

  /**
   * Gets role names for a user's roles.
   * Uses cached role→name mapping for performance.
   */
  async getUserRoleNames(roleIds: Types.ObjectId[]): Promise<string[]> {
    if (this.isCacheStale()) {
      await this.refreshCache();
    }

    const names: string[] = [];
    for (const roleId of roleIds) {
      const name = this.roleNamesCache.get(roleId.toString());
      if (name) {
        names.push(name);
      }
    }
    return names;
  }

  // ==================== Cache Management ====================

  /**
   * Invalidates cache when roles are modified.
   */
  invalidateCache(): void {
    this.cacheLastUpdated = new Date(0); // Force refresh on next access
    this.logger.debug('Role cache invalidated');
  }

  private isCacheStale(): boolean {
    return Date.now() - this.cacheLastUpdated.getTime() > CACHE_TTL_MS;
  }

  private async refreshCache(): Promise<void> {
    const roles = await this.roleModel.find({ isActive: true }).lean();

    this.rolePermissionsCache.clear();
    this.roleNamesCache.clear();

    for (const role of roles) {
      this.rolePermissionsCache.set(role._id.toString(), role.permissions);
      this.roleNamesCache.set(role._id.toString(), role.name);
    }

    this.cacheLastUpdated = new Date();
    this.logger.debug(`Role cache refreshed: ${roles.length} roles loaded`);
  }

  // ==================== Seeding ====================

  private async seedDefaultRoles(): Promise<void> {
    this.logger.log('Starting role seeding...');
    let seededCount = 0;
    let existingCount = 0;

    for (const roleData of DEFAULT_ROLES) {
      try {
        const existing = await this.roleModel.findOne({ name: roleData.name });
        if (!existing) {
          await this.roleModel.create(roleData);
          this.logger.log(`Default role seeded: ${roleData.name}`);
          seededCount++;
        } else {
          existingCount++;
          // System roles: add any newly declared permissions without removing custom ones.
          if (
            existing.isSystem
            && roleData.permissions.length > 0
            && !existing.permissions.includes('*')
          ) {
            const missing = roleData.permissions.filter(
              (p) => !existing.permissions.includes(p),
            );
            if (missing.length > 0) {
              await this.roleModel.updateOne(
                { _id: existing._id },
                { $addToSet: { permissions: { $each: missing } } },
              );
              this.logger.log(
                `System role ${roleData.name}: added permissions ${missing.join(', ')}`,
              );
            }
          }
        }
      } catch (error) {
        this.logger.error(`Failed to seed role: ${roleData.name}`, {
          error: (error as Error).message,
        });
      }
    }

    this.logger.log(`Role seeding complete: ${seededCount} created, ${existingCount} already existed`);
  }

  // ==================== Helpers ====================

  private toRoleResponse(role: RoleDocument): RoleResponse {
    return {
      id: role._id.toString(),
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      isActive: role.isActive,
      isSystem: role.isSystem,
      priority: role.priority,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
