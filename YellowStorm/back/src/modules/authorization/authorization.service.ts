import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { LoggerService } from '../logger';
import { ROLE_STORE, type RoleRecord, type RoleStore } from './persistence/role.store';
import { USER_STORE, type UserStore } from '../user/persistence/user.store';
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
    @Inject(ROLE_STORE) private readonly roleStore: RoleStore,
    @Inject(USER_STORE) private readonly userStore: UserStore,
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
    if (await this.roleStore.findByName(dto.name.toLowerCase())) {
      throw new ConflictException(ErrorCode.ROLE_ALREADY_EXISTS);
    }

    const role = await this.roleStore.create({
      name: dto.name.toLowerCase(),
      description: dto.description,
      permissions: dto.permissions,
      isActive: dto.isActive ?? true,
      isSystem: false, // User-created roles are never system roles
      priority: dto.priority ?? 0,
    });

    this.invalidateCache();

    this.logger.log('Role created', { roleId: role.id, name: role.name });

    return this.toRoleResponse(role);
  }

  async updateRole(id: string, dto: UpdateRoleDto): Promise<RoleResponse> {
    const role = await this.roleStore.findById(id);
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
      if (await this.roleStore.findByName(dto.name.toLowerCase())) {
        throw new ConflictException(ErrorCode.ROLE_ALREADY_EXISTS);
      }
    }

    // Update role (system roles are fully editable - seeding only creates if not exists)
    const patch: Partial<RoleRecord> = {};
    if (dto.name !== undefined) patch.name = dto.name.toLowerCase();
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.permissions !== undefined) patch.permissions = dto.permissions;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.priority !== undefined) patch.priority = dto.priority;

    const updated = await this.roleStore.update(id, patch);

    this.invalidateCache();

    this.logger.log('Role updated', { roleId: id, name: updated?.name, isSystem: updated?.isSystem });

    return this.toRoleResponse(updated ?? role);
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.roleStore.findById(id);
    if (!role) {
      throw new NotFoundException(ErrorCode.ROLE_NOT_FOUND);
    }

    // System roles cannot be deleted
    if (role.isSystem) {
      throw new ForbiddenException(ErrorCode.ROLE_SYSTEM_PROTECTED);
    }

    // Atomic: detaches every user and bumps their permissions_version in one
    // transaction (plan 1A.2).
    await this.roleStore.deleteByIdAndDetach(id);

    this.invalidateCache();

    this.logger.log('Role deleted', { roleId: id, name: role.name });
  }

  async findAllRoles(): Promise<RoleResponse[]> {
    const roles = await this.roleStore.findAll();
    return roles.map((role) => this.toRoleResponse(role));
  }

  async findActiveRoles(): Promise<RoleResponse[]> {
    const roles = await this.roleStore.findAllActive();
    return roles.map((role) => this.toRoleResponse(role));
  }

  async findRoleById(id: string): Promise<RoleResponse> {
    const role = await this.roleStore.findById(id);
    if (!role) {
      throw new NotFoundException(ErrorCode.ROLE_NOT_FOUND);
    }
    return this.toRoleResponse(role);
  }

  async findRoleByName(name: string): Promise<RoleResponse | null> {
    const role = await this.roleStore.findByName(name.toLowerCase());
    return role ? this.toRoleResponse(role) : null;
  }

  // ==================== User Role Assignment ====================

  async assignRoleToUser(userId: string, roleId: string): Promise<void> {
    const role = await this.roleStore.findById(roleId);
    if (!role || !role.isActive) {
      throw new NotFoundException(ErrorCode.ROLE_NOT_FOUND);
    }

    await this.userStore.addRoleAndBump(userId, roleId);

    this.logger.log('Role assigned to user', { userId, roleId, roleName: role.name });
  }

  async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    await this.userStore.removeRoleAndBump(userId, roleId);

    this.logger.log('Role removed from user', { userId, roleId });
  }

  async getUserRoles(userId: string): Promise<RoleResponse[]> {
    const user = await this.userStore.findByIdWithRoles(userId);
    if (!user || user.roles.length === 0) {
      return [];
    }

    const roles = await this.roleStore.findByIds(user.roles.map((r) => r.id));
    return user.roles
      .map((ref) => roles.get(ref.id))
      .filter((role): role is RoleRecord => Boolean(role) && role!.isActive)
      .map((role) => this.toRoleResponse(role));
  }

  // ==================== Permission Resolution ====================

  /**
   * Gets all permissions for a user by expanding their roles.
   * Uses cached role→permissions mapping for performance.
   */
  async getUserPermissions(roleIds: readonly (string | { toString(): string })[]): Promise<string[]> {
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
  async getUserRoleNames(roleIds: readonly (string | { toString(): string })[]): Promise<string[]> {
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
    const roles = await this.roleStore.findAllActive();

    this.rolePermissionsCache.clear();
    this.roleNamesCache.clear();

    for (const role of roles) {
      this.rolePermissionsCache.set(role.id, role.permissions);
      this.roleNamesCache.set(role.id, role.name);
    }

    this.cacheLastUpdated = new Date();
    this.logger.debug(`Role cache refreshed: ${roles.length} roles loaded`);
  }

  // ==================== Seeding ====================

  private async seedDefaultRoles(): Promise<void> {
    this.logger.log('Starting role seeding...');
    await this.roleStore.ensureDefaults(DEFAULT_ROLES);
    this.logger.log(`Role seeding complete: ${DEFAULT_ROLES.length} default roles ensured`);
  }

  // ==================== Helpers ====================

  private toRoleResponse(role: RoleRecord): RoleResponse {
    return {
      id: role.id,
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
