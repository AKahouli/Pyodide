import { isObjectId } from '@common/postgres/object-id';
import { normalizeObjectId } from '@common/postgres/object-id';
import { Inject, Injectable } from '@nestjs/common';
import { CryptoService } from '../../../common/services/crypto.service';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { SKILL_STORE,   type SkillStore } from '../../skill/persistence/skill.store';
import type { ConnectorAction, ConnectorDynamicHeader } from '../connector.types';
import type { ConnectorCredentialRow } from '../persistence/connector.store';
import { ConnectionStatus } from '../../connected-app/connected-app.types';
import {      
  type ConnectorAdminAuthRow,        
} from '../persistence/connector.store';
import { withTransaction } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import { ExportCatalogDto } from '../dto/catalog-transfer.dto';
import {
  CatalogArchiveV1,
  CatalogCategoryRecord,
  CatalogConflictPolicy,
  CatalogConnectorRecord,
  CatalogImportResult,
  CatalogSkillRecord,
  EncryptedCatalogArchive,
} from '../interfaces/catalog-transfer.interface';
import { decryptCatalogArchive, encryptCatalogArchive } from '../utils/catalog-archive-crypto.util';
import { PgSkillCategoryStore } from '../../skill/persistence/pg-skill.store';
import { PgConnectorAdminAuthStore } from '../persistence/pg-connector.store';
import { PgConnectorCredentialStore } from '../persistence/pg-connector.store';
import { PgConnectorCategoryStore } from '../persistence/pg-connector.store';
import { PgConnectorStore } from '../persistence/pg-connector.store';
import { PgConnectedAppDefinitionStore } from '../../connected-app/persistence/pg-connected-app.store';
import { PgUserAppConnectionStore } from '../../connected-app/persistence/pg-connected-app.store';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
export class CatalogTransferService {
  constructor(
    private readonly connectorStore: PgConnectorStore,
    private readonly connectorCategoryStore: PgConnectorCategoryStore,
    private readonly credentialStore: PgConnectorCredentialStore,
    private readonly adminAuthStore: PgConnectorAdminAuthStore,
    @Inject(SKILL_STORE) private readonly skillStore: SkillStore,
    private readonly skillCategoryStore: PgSkillCategoryStore,
    private readonly appDefinitionStore: PgConnectedAppDefinitionStore,
    private readonly appConnectionStore: PgUserAppConnectionStore,
    @Inject(DRIZZLE_DB) private readonly pgDb: NodePgDatabase<typeof schema>,
    private readonly cryptoService: CryptoService,
  ) {}

  async exportConnectors(
    userId: string,
    dto: ExportCatalogDto,
  ): Promise<{ filename: string; buffer: Buffer; securityIncluded: boolean }> {
    this.validateSelection(dto);
    const connectors = await this.connectorStore.findAllExport(dto.selection === 'all' ? undefined : dto.ids);
    const skillIds = Array.from(new Set(connectors.flatMap((connector) =>
      connector.skillIds.map((id) => id.toString()),
    )));
    const skills = skillIds.length
      ? await this.skillStore.findAllExport(skillIds)
      : [];
    const archive = await this.buildArchive(userId, 'connectors', connectors, skills, Boolean(dto.includeSecurity));
    return this.serializeArchive(archive, dto.passphrase);
  }

  async exportSkills(
    userId: string,
    dto: ExportCatalogDto,
  ): Promise<{ filename: string; buffer: Buffer; securityIncluded: boolean }> {
    this.validateSelection(dto);
    const skills = await this.skillStore.findAllExport(dto.selection === 'all' ? undefined : dto.ids);
    const archive = await this.buildArchive(userId, 'skills', [], skills, false);
    return this.serializeArchive(archive);
  }

  parseArchive(buffer: Buffer, passphrase?: string): CatalogArchiveV1 {
    if (!buffer.length || buffer.length > MAX_ARCHIVE_BYTES) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'The catalog archive is empty or too large.');
    }
    let parsed: CatalogArchiveV1 | EncryptedCatalogArchive;
    try {
      parsed = JSON.parse(buffer.toString('utf8')) as CatalogArchiveV1 | EncryptedCatalogArchive;
    } catch {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'The catalog archive is not valid JSON.');
    }
    const encrypted = parsed.format === 'yellowstorm-catalog-encrypted';
    const archive = encrypted
      ? decryptCatalogArchive(parsed as EncryptedCatalogArchive, passphrase ?? '')
      : parsed as CatalogArchiveV1;
    if (archive.securityIncluded && !encrypted) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Security settings must be stored in an encrypted catalog archive.');
    }
    this.validateArchive(archive);
    return archive;
  }

  async importArchive(
    userId: string,
    archive: CatalogArchiveV1,
    conflictPolicy: CatalogConflictPolicy,
  ): Promise<CatalogImportResult> {
    const ownerId = normalizeObjectId(userId);
    const result: CatalogImportResult = {
      skills: { created: 0, updated: 0, skipped: 0 },
      connectors: { created: 0, updated: 0, skipped: 0 },
      categories: { created: 0, reused: 0 },
      security: { credentials: 0, connectedApps: 0, tokens: 0 },
    };
    // Plan 3.7: the whole catalog import is one PG transaction again. All
    // upserts are idempotent — skills by (slug, createdBy), connectors by
    // (slug, createdBy), connections by (userId, appKey), credentials by
    // (connectorId, userId, displayName) — so re-running converges.
    await withTransaction(this.pgDb, async () => {
      const skillCategoryIds = await this.importSkillCategories(
        archive.skillCategories,
        conflictPolicy,
        result,
      );
      const skillIds = await this.importSkills(
        archive.skills,
        userId,
        skillCategoryIds,
        conflictPolicy,
        result,
      );
      const connectorCategoryIds = await this.importConnectorCategories(
        archive.connectorCategories,
        ownerId,
        conflictPolicy,
        result,
      );
      await this.importConnectors(
        archive.connectors,
        ownerId,
        connectorCategoryIds,
        skillIds,
        conflictPolicy,
        result,
      );
      if (archive.securityIncluded && archive.security) {
        await this.importSecurity(archive, ownerId, conflictPolicy, result);
      }
    });
    return result;
  }

  private async buildArchive(
    userId: string,
    resource: 'connectors' | 'skills',
    connectors: Record<string, any>[],
    skills: Record<string, any>[],
    includeSecurity: boolean,
  ): Promise<CatalogArchiveV1> {
    const connectorCategoryIds = Array.from(new Set(connectors.flatMap((item) => item.categoryId ? [String(item.categoryId)] : [])));
    const skillCategoryIds = Array.from(new Set(skills.flatMap((item) => item.categoryId ? [String(item.categoryId)] : [])));
    const [connectorCategories, skillCategories] = await Promise.all([
      this.resolveConnectorCategories(connectorCategoryIds),
      this.resolveSkillCategories(skillCategoryIds),
    ]);
    const connectorCategoryNames = new Map(connectorCategories.map((c) => [c.id, c.name]));
    const skillCategoryNames = new Map(skillCategories.map((c) => [c.id, c.name]));
    const skillSlugById = new Map(skills.map((skill) => [skill.id, skill.slug || skill.name]));
    const archive: CatalogArchiveV1 = {
      format: 'yellowstorm-catalog',
      version: 1,
      resource,
      exportedAt: new Date().toISOString(),
      securityIncluded: includeSecurity,
      connectorCategories: connectorCategories.map((category) => this.projectCategory(category)),
      skillCategories: skillCategories.map((category) => this.projectCategory(category)),
      skills: skills.map((skill) => this.projectSkill(skill, skillCategoryNames)),
      connectors: connectors.map((connector) => this.projectConnector(
        connector,
        connectorCategoryNames,
        skillSlugById,
        includeSecurity,
      )),
    };

    if (includeSecurity) {
      archive.security = await this.exportSecurity(userId, connectors);
    }
    return archive;
  }

  private async exportSecurity(userId: string, connectors: Record<string, any>[]) {
    const connectorIds = connectors.map((connector) => String(connector.id ?? connector._id));
    const connectorSlugById = new Map(connectors.map((connector) => [String(connector.id ?? connector._id), connector.slug]));
    const appKeys = Array.from(new Set(connectors.map((connector) => connector.connectedAppKey).filter(Boolean)));
    const ownerId = normalizeObjectId(userId);
    const [allCredentials, allDefinitions, userConnections, adminAuthRows] = await Promise.all([
      this.credentialStore.list({ userId: userId }),
      this.appDefinitionStore.findAll(),
      this.appConnectionStore.listByUser(userId),
      Promise.all(appKeys.map((appKey) => this.adminAuthStore.findByUserAndApp(userId, appKey))),
    ]);
    const connectorIdSet = new Set(connectorIds);
    const appKeySet = new Set(appKeys);
    const credentials = allCredentials.filter((c) => connectorIdSet.has(c.connectorId));
    const definitions = allDefinitions.filter((d) => appKeySet.has(d.appKey));
    const connections = userConnections.filter((c) => appKeySet.has(c.appKey));
    const adminAuth = adminAuthRows.filter(
      (a): a is ConnectorAdminAuthRow => a !== null && appKeySet.has(a.appKey),
    );
    definitions;
    connections;
    return {
      connectorCredentials: credentials.map((credential) => ({
        connectorSlug: connectorSlugById.get(credential.connectorId.toString()) ?? '',
        displayName: credential.displayName,
        authPayload: credential.authPayload ?? {},
        status: credential.status,
        lastValidatedAt: this.dateString(credential.lastValidatedAt),
        expiresAt: this.dateString(credential.expiresAt),
      })),
      connectedAppDefinitions: definitions.map((definition) => ({
        appKey: definition.appKey,
        displayName: definition.displayName,
        description: definition.description ?? '',
        iconKey: definition.iconKey ?? '',
        authorizationUrl: definition.authorizationUrl,
        tokenUrl: definition.tokenUrl,
        revokeUrl: definition.revokeUrl ?? '',
        clientId: this.decryptStored(definition.clientId),
        clientSecret: this.decryptStored(definition.clientSecret),
        tenantId: definition.tenantId ? this.decryptStored(definition.tenantId) : '',
        scopes: definition.scopes ?? [],
        pkceEnabled: definition.pkceEnabled ?? true,
        enabled: definition.enabled ?? true,
        sortOrder: definition.sortOrder ?? 0,
      })),
      userAppConnections: connections.map((connection) => ({
        appKey: connection.appKey,
        accessToken: this.decryptStored(connection.accessToken),
        refreshToken: connection.refreshToken ? this.decryptStored(connection.refreshToken) : '',
        tokenExpiresAt: this.dateString(connection.tokenExpiresAt),
        scopes: connection.scopes ?? [],
        providerAccountId: connection.providerAccountId ?? '',
        providerEmail: connection.providerEmail ?? '',
        status: connection.status,
        lastUsedAt: this.dateString(connection.lastUsedAt),
        lastRefreshedAt: this.dateString(connection.lastRefreshedAt),
        errorMessage: connection.errorMessage ?? '',
      })),
      adminConnectorAuth: adminAuth.map((auth) => ({
        appKey: auth.appKey,
        accessToken: auth.accessToken ? this.decryptStored(auth.accessToken) : '',
        refreshToken: auth.refreshToken ? this.decryptStored(auth.refreshToken) : '',
        tokenExpiresAt: this.dateString(auth.tokenExpiresAt),
        scopes: auth.scopes ?? [],
        providerAccountId: auth.providerAccountId ?? '',
        providerEmail: auth.providerEmail ?? '',
        connected: auth.connected ?? false,
        status: auth.status,
        disconnectedAt: this.dateString(auth.disconnectedAt),
        lastUsedAt: this.dateString(auth.lastUsedAt),
        lastRefreshedAt: this.dateString(auth.lastRefreshedAt),
        errorMessage: auth.errorMessage ?? '',
      })),
    };
  }

  /** Category id -> name for PG-backed skill categories (export archive). */
  private async resolveSkillCategories(ids: string[]) {
    if (!ids.length) return [];
    const all = await this.skillCategoryStore.findAll();
    const wanted = new Set(ids);
    return all.filter((c) => wanted.has(c.id));
  }

  private async importSkillCategories(
    categories: CatalogCategoryRecord[],
    conflictPolicy: CatalogConflictPolicy,
    result: CatalogImportResult,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const category of categories) {
      let existing = await this.skillCategoryStore.findByNameInsensitive(category.name);
      if (!existing) {
        if (category.isSystem) {
          throw new BadRequestException(ErrorCode.BAD_REQUEST, 'System skill categories cannot be created by catalog import.');
        }
        existing = await this.skillCategoryStore.insert({ name: category.name, description: category.description });
        result.categories.created += 1;
      } else {
        if (!existing.isSystem && category.isSystem) {
          throw new BadRequestException(ErrorCode.BAD_REQUEST, 'A skill category cannot be elevated to a system category.');
        }
        if (conflictPolicy === 'overwrite' && !existing.isSystem) {
          existing = await this.skillCategoryStore.update(existing.id, { description: category.description }) ?? existing;
        }
        result.categories.reused += 1;
      }
      ids.set(category.name, existing.id);
    }
    return ids;
  }

  private async importConnectorCategories(
    categories: CatalogCategoryRecord[],
    ownerId: string,
    conflictPolicy: CatalogConflictPolicy,
    result: CatalogImportResult,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const category of categories) {
      let existing = await this.connectorCategoryStore.findByOwnerName(String(ownerId), category.name);
      if (!existing) {
        if (category.isSystem) {
          throw new BadRequestException(ErrorCode.BAD_REQUEST, 'System connector categories cannot be created by catalog import.');
        }
        existing = await this.connectorCategoryStore.insert({
          name: category.name,
          description: category.description,
          createdBy: String(ownerId),
        });
        result.categories.created += 1;
      } else {
        if (!existing.isSystem && category.isSystem) {
          throw new BadRequestException(ErrorCode.BAD_REQUEST, 'A connector category cannot be elevated to a system category.');
        }
        if (conflictPolicy === 'overwrite' && !existing.isSystem) {
          existing = await this.connectorCategoryStore.update(existing.id, { description: category.description }) ?? existing;
        }
        result.categories.reused += 1;
      }
      ids.set(category.name, existing.id);
    }
    return ids;
  }

  private async importSkills(
    skills: CatalogSkillRecord[],
    userId: string,
    categoryIds: Map<string, string>,
    conflictPolicy: CatalogConflictPolicy,
    result: CatalogImportResult,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const skill of skills) {
      const categoryId = skill.categoryName ? categoryIds.get(skill.categoryName) ?? null : null;
      const files = (skill.files ?? []).map((file) => ({
        path: file.path,
        kind: file.kind,
        mimeType: file.mimeType ?? '',
        content: file.content ?? '',
      }));
      const existing = await this.skillStore.findByOwnerSlug(userId, skill.slug);
      if (existing && conflictPolicy === 'skip') {
        result.skills.skipped += 1;
        ids.set(skill.slug, existing.id);
        continue;
      }
      if (existing) {
        const updated = await this.skillStore.update(existing.id, {
          name: skill.name,
          description: skill.description,
          icon: skill.icon,
          color: skill.color,
          iconColor: skill.iconColor,
          categoryId,
          license: skill.license,
          compatibility: skill.compatibility,
          metadata: skill.metadata,
          allowedTools: skill.allowedTools,
          instructions: skill.instructions,
          files,
          isActive: skill.isActive,
        });
        result.skills.updated += 1;
        ids.set(skill.slug, updated!.id);
      } else {
        const created = await this.skillStore.insert({
          slug: skill.slug,
          name: skill.name,
          description: skill.description,
          icon: skill.icon,
          color: skill.color,
          iconColor: skill.iconColor,
          categoryId,
          license: skill.license,
          compatibility: skill.compatibility,
          metadata: skill.metadata,
          allowedTools: skill.allowedTools,
          instructions: skill.instructions,
          files,
          isActive: skill.isActive,
          createdBy: userId,
        });
        result.skills.created += 1;
        ids.set(skill.slug, created.id);
      }
    }
    return ids;
  }

  private async importConnectors(
    connectors: CatalogConnectorRecord[],
    ownerId: string,
    categoryIds: Map<string, string>,
    skillIds: Map<string, string>,
    conflictPolicy: CatalogConflictPolicy,
    result: CatalogImportResult,
  ): Promise<void> {
    const createdBy = String(ownerId);
    for (const connector of connectors) {
      const existing = await this.connectorStore.findBySlugAndOwner(connector.slug, createdBy);
      const missingSkills = connector.referencedSkillSlugs.filter((slug) => !skillIds.has(slug));
      if (missingSkills.length) {
        const resolved = await this.skillStore.findIdsBySlugs(createdBy, missingSkills);
        resolved.forEach((id, slug) => skillIds.set(slug, id));
      }
      const unresolved = connector.referencedSkillSlugs.filter((slug) => !skillIds.has(slug));
      if (unresolved.length) {
        throw new BadRequestException(
          ErrorCode.BAD_REQUEST,
          `Connector '${connector.slug}' references missing skills: ${unresolved.join(', ')}.`,
        );
      }
      if (existing && conflictPolicy === 'skip') {
        result.connectors.skipped += 1;
        continue;
      }
      const common = {
        slug: connector.slug,
        name: connector.name,
        description: connector.description,
        icon: connector.icon ?? '',
        color: connector.color ?? '',
        iconColor: connector.iconColor ?? 'light',
        categoryId: connector.categoryName ? categoryIds.get(connector.categoryName) ?? null : null,
        authType: connector.authType ?? 'none',
        authConfigSchema: connector.authConfigSchema ?? {},
        authSourceType: connector.authSourceType ?? 'credential',
        connectedAppKey: connector.connectedAppKey ?? '',
        mcpTransportType: connector.mcpTransportType ?? 'streamable_http',
        mcpServerUrl: connector.mcpServerUrl ?? '',
        skillIds: connector.referencedSkillSlugs.map((slug) => skillIds.get(slug)!),
        isActive: connector.isActive ?? true,
      };
      if (existing) {
        await this.connectorStore.update(existing.id, {
          ...common,
          runtimeAuthConfig: this.restoreRedactedValues(
            connector.runtimeAuthConfig,
            existing.runtimeAuthConfig ?? {},
          ) as Record<string, unknown>,
          mcpServerConfig: this.restoreRedactedValues(
            connector.mcpServerConfig,
            existing.mcpServerConfig ?? {},
          ) as Record<string, unknown>,
          dynamicHeaders: (connector.dynamicHeaders ?? []) as ConnectorDynamicHeader[],
          actions: (connector.actions ?? []) as ConnectorAction[],
          isHidden: connector.isHidden ?? false,
        });
        result.connectors.updated += 1;
      } else {
        await this.connectorStore.insert({
          ...common,
          runtimeAuthConfig: connector.runtimeAuthConfig ?? {},
          mcpServerConfig: connector.mcpServerConfig ?? {},
          dynamicHeaders: (connector.dynamicHeaders ?? []) as ConnectorDynamicHeader[],
          actions: (connector.actions ?? []) as ConnectorAction[],
          isSystem: false,
          isHidden: connector.isHidden ?? false,
          createdBy,
        });
        result.connectors.created += 1;
      }
    }
  }

  private async importSecurity(
    archive: CatalogArchiveV1,
    ownerId: string,
    conflictPolicy: CatalogConflictPolicy,
    result: CatalogImportResult,
  ): Promise<void> {
    const security = archive.security!;
    const owner = String(ownerId);
    for (const definition of security.connectedAppDefinitions) {
      const existing = await this.appDefinitionStore.findByKey(definition.appKey);
      const encrypted = {
        appKey: definition.appKey,
        displayName: definition.displayName,
        description: definition.description ?? null,
        iconKey: definition.iconKey ?? null,
        authorizationUrl: definition.authorizationUrl,
        tokenUrl: definition.tokenUrl,
        revokeUrl: definition.revokeUrl ?? null,
        clientId: this.cryptoService.encrypt(definition.clientId),
        clientSecret: this.cryptoService.encrypt(definition.clientSecret),
        tenantId: definition.tenantId ? this.cryptoService.encrypt(definition.tenantId) : null,
        scopes: definition.scopes ?? [],
        pkceEnabled: definition.pkceEnabled ?? true,
        enabled: definition.enabled ?? true,
        sortOrder: definition.sortOrder ?? 0,
      };
      if (!existing) {
        await this.appDefinitionStore.insert(encrypted);
        result.security.connectedApps += 1;
      } else if (conflictPolicy === 'overwrite') {
        await this.appDefinitionStore.update(existing.id, encrypted);
        result.security.connectedApps += 1;
      }
    }
    for (const connection of security.userAppConnections) {
      const data = this.encryptTokenRecord(connection);
      const existing = await this.appConnectionStore.findByUserAndApp(owner, connection.appKey);
      if (!existing) {
        await this.appConnectionStore.insertForImport(owner, connection.appKey, {
          accessToken: String(data.accessToken ?? ''),
          refreshToken: (data.refreshToken as string | undefined) ?? null,
          tokenExpiresAt: (data.tokenExpiresAt as Date | null) ?? null,
          scopes: (data.scopes as string[]) ?? [],
          providerAccountId: (data.providerAccountId as string | undefined) ?? null,
          providerEmail: (data.providerEmail as string | undefined) ?? null,
          status: (data.status as ConnectionStatus) ?? ConnectionStatus.ACTIVE,
          errorMessage: (data.errorMessage as string | undefined) ?? null,
        });
      } else if (conflictPolicy === 'overwrite') {
        await this.appConnectionStore.updateById(existing.id, {
          accessToken: String(data.accessToken ?? ''),
          refreshToken: (data.refreshToken as string | undefined) ?? null,
          tokenExpiresAt: (data.tokenExpiresAt as Date | null) ?? null,
          scopes: (data.scopes as string[]) ?? [],
          providerAccountId: (data.providerAccountId as string | undefined) ?? null,
          providerEmail: (data.providerEmail as string | undefined) ?? null,
          status: (data.status as ConnectionStatus) ?? ConnectionStatus.ACTIVE,
          errorMessage: (data.errorMessage as string | undefined) ?? null,
        });
      }
      result.security.tokens += 1;
    }
    for (const auth of security.adminConnectorAuth) {
      const data = this.encryptTokenRecord(auth);
      const existing = await this.adminAuthStore.findByUserAndApp(owner, auth.appKey);
      if (!existing) {
        await this.adminAuthStore.insertForImport(owner, auth.appKey, {
          accessToken: (data.accessToken as string | undefined) ?? null,
          refreshToken: (data.refreshToken as string | undefined) ?? null,
          tokenExpiresAt: (data.tokenExpiresAt as Date | null) ?? null,
          scopes: (data.scopes as string[]) ?? [],
          providerAccountId: (data.providerAccountId as string | undefined) ?? null,
          providerEmail: (data.providerEmail as string | undefined) ?? null,
          connected: (data.connected as boolean) ?? true,
          status: (data.status as string) ?? 'active',
          disconnectedAt: (data.disconnectedAt as Date | null) ?? null,
          lastUsedAt: (data.lastUsedAt as Date | null) ?? null,
          lastRefreshedAt: (data.lastRefreshedAt as Date | null) ?? null,
          errorMessage: (data.errorMessage as string | undefined) ?? null,
        });
      } else if (conflictPolicy === 'overwrite') {
        // Explicit columns (R-13): the archive record's ids/keys must not leak
        // into the UPDATE.
        await this.adminAuthStore.updateById(existing.id, {
          accessToken: (data.accessToken as string | undefined) ?? null,
          refreshToken: (data.refreshToken as string | undefined) ?? null,
          tokenExpiresAt: (data.tokenExpiresAt as Date | null) ?? null,
          scopes: (data.scopes as string[]) ?? [],
          providerAccountId: (data.providerAccountId as string | undefined) ?? null,
          providerEmail: (data.providerEmail as string | undefined) ?? null,
          connected: (data.connected as boolean) ?? true,
          status: (data.status as string) ?? 'active',
          disconnectedAt: (data.disconnectedAt as Date | null) ?? null,
          lastUsedAt: (data.lastUsedAt as Date | null) ?? null,
          lastRefreshedAt: (data.lastRefreshedAt as Date | null) ?? null,
          errorMessage: (data.errorMessage as string | undefined) ?? null,
        });
      }
      result.security.tokens += 1;
    }
    for (const credential of security.connectorCredentials) {
      const connector = await this.connectorStore.findBySlugAndOwner(credential.connectorSlug, owner);
      if (!connector) continue;
      const existing = await this.credentialStore.findByConnectorUserDisplayName(
        connector.id,
        owner,
        credential.displayName,
      );
      const payload: Partial<Pick<ConnectorCredentialRow, 'displayName' | 'authPayload' | 'status' | 'expiresAt' | 'lastValidatedAt'>> = {
        displayName: credential.displayName,
        authPayload: credential.authPayload ?? {},
        status: (credential.status) ?? 'active',
        lastValidatedAt: this.optionalDate(credential.lastValidatedAt),
        expiresAt: this.optionalDate(credential.expiresAt),
      };
      if (!existing) {
        await this.credentialStore.insert({
          connectorId: connector.id,
          displayName: credential.displayName,
          authPayload: payload.authPayload!,
          status: payload.status!,
          expiresAt: payload.expiresAt ?? null,
          userId: owner,
        });
      } else if (conflictPolicy === 'overwrite') {
        await this.credentialStore.update(existing.id, payload);
      }
      result.security.credentials += 1;
    }
  }

  /**
   * Explicit column patch for an archive token record (R-13): never spread the
   * raw record (it carries archive ids/keys) and never fabricate a userId —
   * ownership is handled by the store call sites.
   */
  private encryptTokenRecord(record: Record<string, any>): Record<string, unknown> {
    return {
      accessToken: record.accessToken ? this.cryptoService.encrypt(record.accessToken) : undefined,
      refreshToken: record.refreshToken ? this.cryptoService.encrypt(record.refreshToken) : undefined,
      tokenExpiresAt: this.optionalDate(record.tokenExpiresAt),
      scopes: record.scopes,
      providerAccountId: record.providerAccountId,
      providerEmail: record.providerEmail,
      connected: record.connected,
      status: record.status,
      disconnectedAt: this.optionalDate(record.disconnectedAt),
      lastUsedAt: this.optionalDate(record.lastUsedAt),
      lastRefreshedAt: this.optionalDate(record.lastRefreshedAt),
      errorMessage: record.errorMessage,
    };
  }

  private projectSkill(skill: Record<string, any>, categoryNames: Map<string, string>): CatalogSkillRecord {
    return {
      slug: skill.slug || skill.name,
      name: skill.name,
      description: skill.description ?? '',
      icon: skill.icon ?? '',
      color: skill.color ?? '',
      iconColor: skill.iconColor ?? 'light',
      categoryName: skill.categoryId ? categoryNames.get(skill.categoryId.toString()) ?? null : null,
      license: skill.license ?? '',
      compatibility: skill.compatibility ?? '',
      metadata: skill.metadata ?? {},
      allowedTools: skill.allowedTools ?? [],
      instructions: skill.instructions ?? '',
      files: (skill.files ?? []).map((file: Record<string, any>) => ({
        path: file.path,
        kind: file.kind,
        mimeType: file.mimeType ?? '',
        content: file.content ?? '',
      })),
      isActive: skill.isActive ?? true,
    };
  }

  private projectConnector(
    connector: Record<string, any>,
    categoryNames: Map<string, string>,
    skillSlugById: Map<string, string>,
    includeSecurity: boolean,
  ): CatalogConnectorRecord {
    const protect = (value: Record<string, unknown>) => includeSecurity ? value : this.redactSecrets(value);
    return {
      slug: connector.slug,
      name: connector.name,
      description: connector.description ?? '',
      icon: connector.icon ?? '',
      color: connector.color ?? '',
      iconColor: connector.iconColor ?? 'light',
      categoryName: connector.categoryId ? categoryNames.get(connector.categoryId.toString()) ?? null : null,
      authType: connector.authType ?? 'none',
      authConfigSchema: connector.authConfigSchema ?? {},
      authSourceType: connector.authSourceType ?? 'credential',
      connectedAppKey: connector.connectedAppKey ?? '',
      runtimeAuthConfig: protect(connector.runtimeAuthConfig ?? {}),
      mcpTransportType: connector.mcpTransportType ?? 'streamable_http',
      mcpServerUrl: connector.mcpServerUrl ?? '',
      mcpServerConfig: protect(connector.mcpServerConfig ?? {}),
      dynamicHeaders: (connector.dynamicHeaders ?? []).map((header: Record<string, any>) => ({
        headerName: header.headerName,
        source: header.source,
        enabled: header.enabled ?? true,
      })),
      actions: (connector.actions ?? []).map((action: Record<string, any>) => ({
        key: action.key,
        label: action.label,
        description: action.description ?? '',
        parameterSchema: action.parameterSchema ?? {},
        outputSchema: action.outputSchema ?? {},
        safety: action.safety ?? 'read',
        supportsBatch: action.supportsBatch ?? false,
        supportsIteration: action.supportsIteration ?? false,
        isEnabled: action.isEnabled ?? true,
        resultKind: action.resultKind ?? 'generic',
        citationMode: action.citationMode ?? 'none',
        ...(action.resultMapping ? { resultMapping: action.resultMapping } : {}),
      })),
      referencedSkillSlugs: (connector.skillIds ?? connector.referencedSkillIds ?? [])
        .map((id: unknown) => skillSlugById.get(String(id)))
        .filter((slug: string | undefined): slug is string => Boolean(slug)),
      isActive: connector.isActive ?? true,
      isSystem: connector.isSystem ?? false,
      isHidden: connector.isHidden ?? false,
    };
  }

  private redactSecrets(value: Record<string, unknown>): Record<string, unknown> {
    const visit = (current: unknown, parentKey = ''): unknown => {
      if (Array.isArray(current)) return current.map((item) => visit(item, parentKey));
      if (!current || typeof current !== 'object') return current;
      return Object.fromEntries(Object.entries(current as Record<string, unknown>).map(([key, item]) => {
        const sensitive = /token|secret|password|authorization|api[_-]?key/i.test(key)
          || /headers?|env/i.test(parentKey);
        return [key, sensitive ? '__REDACTED__' : visit(item, key)];
      }));
    };
    return visit(value) as Record<string, unknown>;
  }

  private restoreRedactedValues(imported: unknown, existing: unknown): unknown {
    if (imported === '__REDACTED__') return existing;
    if (Array.isArray(imported)) {
      const existingItems = Array.isArray(existing) ? existing : [];
      return imported.map((item, index) => this.restoreRedactedValues(item, existingItems[index]));
    }
    if (!imported || typeof imported !== 'object') return imported;
    const existingObject = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing as Record<string, unknown>
      : {};
    return Object.fromEntries(
      Object.entries(imported as Record<string, unknown>)
        .map(([key, value]) => [key, this.restoreRedactedValues(value, existingObject[key])])
        .filter(([, value]) => value !== undefined),
    );
  }

  private serializeArchive(archive: CatalogArchiveV1, passphrase?: string) {
    const payload = archive.securityIncluded
      ? encryptCatalogArchive(archive, passphrase ?? '')
      : archive;
    return {
      filename: `yellowstorm-${archive.resource}-${new Date().toISOString().slice(0, 10)}.json`,
      buffer: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
      securityIncluded: archive.securityIncluded,
    };
  }

  private validateSelection(dto: ExportCatalogDto): void {
    if (dto.selection === 'selected' && (!dto.ids?.length || dto.ids.some((id) => !isObjectId(id)))) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Select at least one valid catalog item.');
    }
    if (dto.includeSecurity && !dto.passphrase) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'A passphrase is required when exporting security settings.');
    }
  }

  private validateArchive(archive: CatalogArchiveV1): void {
    if (
      archive.format !== 'yellowstorm-catalog'
      || archive.version !== 1
      || !Array.isArray(archive.skills)
      || !Array.isArray(archive.connectors)
      || !Array.isArray(archive.skillCategories)
      || !Array.isArray(archive.connectorCategories)
    ) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'The catalog archive format or version is unsupported.');
    }
    const invalidSlug = [...archive.skills.map((item) => item.slug), ...archive.connectors.map((item) => item.slug)]
      .find((slug) => !SLUG_PATTERN.test(slug));
    if (invalidSlug) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, `The archive contains an invalid slug: ${invalidSlug}.`);
    }
    for (const skill of archive.skills) {
      for (const file of skill.files) {
        const normalized = file.path.replaceAll('\\', '/');
        if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
          throw new BadRequestException(ErrorCode.BAD_REQUEST, `The archive contains an unsafe skill path: ${file.path}.`);
        }
      }
    }
  }

  private async resolveConnectorCategories(ids: string[]) {
    if (!ids.length) return [];
    const all = await this.connectorCategoryStore.findAll();
    const wanted = new Set(ids);
    return all.filter((c) => wanted.has(c.id));
  }

  private projectCategory(category: Record<string, any>): CatalogCategoryRecord {
    return {
      name: category.name,
      description: category.description ?? '',
      isSystem: category.isSystem ?? false,
    };
  }

  private decryptStored(value: string): string {
    return this.cryptoService.isEncrypted(value) ? this.cryptoService.decrypt(value) : value;
  }

  private dateString(value?: Date | null): string | null {
    return value ? new Date(value).toISOString() : null;
  }

  private optionalDate(value?: string | null): Date | undefined {
    return value ? new Date(value) : undefined;
  }
}
