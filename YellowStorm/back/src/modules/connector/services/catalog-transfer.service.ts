import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { CryptoService } from '../../../common/services/crypto.service';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { ConnectedAppDefinition, ConnectedAppDefinitionDocument } from '../../connected-app/schemas/connected-app-definition.schema';
import { UserAppConnection, UserAppConnectionDocument } from '../../connected-app/schemas/user-app-connection.schema';
import { Skill, SkillDocument } from '../../skill/schemas/skill.schema';
import { SkillCategory, SkillCategoryDocument } from '../../skill/schemas/skill-category.schema';
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
import { AdminConnectorAuth, AdminConnectorAuthDocument } from '../schemas/admin-connector-auth.schema';
import { Connector, ConnectorDocument } from '../schemas/connector.schema';
import { ConnectorCategory, ConnectorCategoryDocument } from '../schemas/connector-category.schema';
import { ConnectorCredential, ConnectorCredentialDocument } from '../schemas/connector-credential.schema';
import { decryptCatalogArchive, encryptCatalogArchive } from '../utils/catalog-archive-crypto.util';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
export class CatalogTransferService {
  constructor(
    @InjectModel(Connector.name) private readonly connectorModel: Model<ConnectorDocument>,
    @InjectModel(ConnectorCategory.name) private readonly connectorCategoryModel: Model<ConnectorCategoryDocument>,
    @InjectModel(ConnectorCredential.name) private readonly credentialModel: Model<ConnectorCredentialDocument>,
    @InjectModel(AdminConnectorAuth.name) private readonly adminAuthModel: Model<AdminConnectorAuthDocument>,
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
    @InjectModel(SkillCategory.name) private readonly skillCategoryModel: Model<SkillCategoryDocument>,
    @InjectModel(ConnectedAppDefinition.name) private readonly appDefinitionModel: Model<ConnectedAppDefinitionDocument>,
    @InjectModel(UserAppConnection.name) private readonly appConnectionModel: Model<UserAppConnectionDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly cryptoService: CryptoService,
  ) {}

  async exportConnectors(
    userId: string,
    dto: ExportCatalogDto,
  ): Promise<{ filename: string; buffer: Buffer; securityIncluded: boolean }> {
    this.validateSelection(dto);
    const connectorFilter = dto.selection === 'all'
      ? {}
      : { _id: { $in: dto.ids!.map((id) => new Types.ObjectId(id)) } };
    const connectors = await this.connectorModel.find(connectorFilter).lean().exec();
    const skillIds = Array.from(new Set(connectors.flatMap((connector) =>
      (connector.referencedSkillIds ?? []).map((id) => id.toString()),
    )));
    const skills = skillIds.length
      ? await this.skillModel.find({ _id: { $in: skillIds.map((id) => new Types.ObjectId(id)) } }).lean().exec()
      : [];
    const archive = await this.buildArchive(userId, 'connectors', connectors, skills, Boolean(dto.includeSecurity));
    return this.serializeArchive(archive, dto.passphrase);
  }

  async exportSkills(
    userId: string,
    dto: ExportCatalogDto,
  ): Promise<{ filename: string; buffer: Buffer; securityIncluded: boolean }> {
    this.validateSelection(dto);
    const skillFilter = dto.selection === 'all'
      ? {}
      : { _id: { $in: dto.ids!.map((id) => new Types.ObjectId(id)) } };
    const skills = await this.skillModel.find(skillFilter).lean().exec();
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
    const ownerId = new Types.ObjectId(userId);
    const session = await this.connection.startSession();
    const result: CatalogImportResult = {
      skills: { created: 0, updated: 0, skipped: 0 },
      connectors: { created: 0, updated: 0, skipped: 0 },
      categories: { created: 0, reused: 0 },
      security: { credentials: 0, connectedApps: 0, tokens: 0 },
    };
    try {
      await session.withTransaction(async () => {
        const skillCategoryIds = await this.importSkillCategories(
          archive.skillCategories,
          conflictPolicy,
          session,
          result,
        );
        const connectorCategoryIds = await this.importConnectorCategories(
          archive.connectorCategories,
          ownerId,
          conflictPolicy,
          session,
          result,
        );
        const skillIds = await this.importSkills(
          archive.skills,
          ownerId,
          skillCategoryIds,
          conflictPolicy,
          session,
          result,
        );
        await this.importConnectors(
          archive.connectors,
          ownerId,
          connectorCategoryIds,
          skillIds,
          conflictPolicy,
          session,
          result,
        );
        if (archive.securityIncluded && archive.security) {
          await this.importSecurity(archive, ownerId, conflictPolicy, session, result);
        }
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  private async buildArchive(
    userId: string,
    resource: 'connectors' | 'skills',
    connectors: Array<Record<string, any>>,
    skills: Array<Record<string, any>>,
    includeSecurity: boolean,
  ): Promise<CatalogArchiveV1> {
    const connectorCategoryIds = connectors.flatMap((item) => item.categoryId ? [item.categoryId] : []);
    const skillCategoryIds = skills.flatMap((item) => item.categoryId ? [item.categoryId] : []);
    const [connectorCategories, skillCategories] = await Promise.all([
      this.connectorCategoryModel.find({ _id: { $in: connectorCategoryIds } }).lean().exec(),
      this.skillCategoryModel.find({ _id: { $in: skillCategoryIds } }).lean().exec(),
    ]);
    const connectorCategoryNames = this.categoryNameMap(connectorCategories);
    const skillCategoryNames = this.categoryNameMap(skillCategories);
    const skillSlugById = new Map(skills.map((skill) => [skill._id.toString(), skill.slug || skill.name]));
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

  private async exportSecurity(userId: string, connectors: Array<Record<string, any>>) {
    const connectorIds = connectors.map((connector) => connector._id);
    const connectorSlugById = new Map(connectors.map((connector) => [connector._id.toString(), connector.slug]));
    const appKeys = Array.from(new Set(connectors.map((connector) => connector.connectedAppKey).filter(Boolean)));
    const ownerId = new Types.ObjectId(userId);
    const [credentials, definitions, connections, adminAuth] = await Promise.all([
      this.credentialModel.find({ connectorId: { $in: connectorIds }, userId: ownerId }).lean().exec(),
      this.appDefinitionModel.find({ appKey: { $in: appKeys } }).lean().exec(),
      this.appConnectionModel.find({ appKey: { $in: appKeys }, userId: ownerId }).lean().exec(),
      this.adminAuthModel.find({ appKey: { $in: appKeys }, userId: ownerId }).lean().exec(),
    ]);
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

  private async importSkillCategories(
    categories: CatalogCategoryRecord[],
    conflictPolicy: CatalogConflictPolicy,
    session: ClientSession,
    result: CatalogImportResult,
  ): Promise<Map<string, Types.ObjectId>> {
    const ids = new Map<string, Types.ObjectId>();
    for (const category of categories) {
      let existing = await this.skillCategoryModel.findOne({ name: category.name }).session(session).exec();
      if (!existing) {
        if (category.isSystem) {
          throw new BadRequestException(ErrorCode.BAD_REQUEST, 'System skill categories cannot be created by catalog import.');
        }
        [existing] = await this.skillCategoryModel.create([category], { session });
        result.categories.created += 1;
      } else {
        if (!existing.isSystem && category.isSystem) {
          throw new BadRequestException(ErrorCode.BAD_REQUEST, 'A skill category cannot be elevated to a system category.');
        }
        if (conflictPolicy === 'overwrite' && !existing.isSystem) {
          existing = await this.skillCategoryModel.findByIdAndUpdate(
            existing._id,
            { $set: { description: category.description } },
            { new: true, session },
          ).exec() ?? existing;
        }
        result.categories.reused += 1;
      }
      ids.set(category.name, existing._id as Types.ObjectId);
    }
    return ids;
  }

  private async importConnectorCategories(
    categories: CatalogCategoryRecord[],
    ownerId: Types.ObjectId,
    conflictPolicy: CatalogConflictPolicy,
    session: ClientSession,
    result: CatalogImportResult,
  ): Promise<Map<string, Types.ObjectId>> {
    const ids = new Map<string, Types.ObjectId>();
    for (const category of categories) {
      let existing = await this.connectorCategoryModel
        .findOne({ name: category.name, createdBy: ownerId })
        .session(session)
        .exec();
      if (!existing) {
        if (category.isSystem) {
          throw new BadRequestException(ErrorCode.BAD_REQUEST, 'System connector categories cannot be created by catalog import.');
        }
        [existing] = await this.connectorCategoryModel.create([{ ...category, createdBy: ownerId }], { session });
        result.categories.created += 1;
      } else {
        if (!existing.isSystem && category.isSystem) {
          throw new BadRequestException(ErrorCode.BAD_REQUEST, 'A connector category cannot be elevated to a system category.');
        }
        if (conflictPolicy === 'overwrite' && !existing.isSystem) {
          existing = await this.connectorCategoryModel.findByIdAndUpdate(
            existing._id,
            { $set: { description: category.description } },
            { new: true, session },
          ).exec() ?? existing;
        }
        result.categories.reused += 1;
      }
      ids.set(category.name, existing._id as Types.ObjectId);
    }
    return ids;
  }

  private async importSkills(
    skills: CatalogSkillRecord[],
    ownerId: Types.ObjectId,
    categoryIds: Map<string, Types.ObjectId>,
    conflictPolicy: CatalogConflictPolicy,
    session: ClientSession,
    result: CatalogImportResult,
  ): Promise<Map<string, Types.ObjectId>> {
    const ids = new Map<string, Types.ObjectId>();
    for (const skill of skills) {
      const data = {
        ...skill,
        categoryId: skill.categoryName ? categoryIds.get(skill.categoryName) ?? null : null,
        createdBy: ownerId,
      } as Record<string, unknown>;
      delete data.categoryName;
      let existing = await this.skillModel.findOne({ slug: skill.slug, createdBy: ownerId }).session(session).exec();
      if (existing && conflictPolicy === 'skip') {
        result.skills.skipped += 1;
      } else if (existing) {
        existing = await this.skillModel.findByIdAndUpdate(existing._id, { $set: data }, { new: true, session }).exec();
        result.skills.updated += 1;
      } else {
        [existing] = await this.skillModel.create([data], { session });
        result.skills.created += 1;
      }
      ids.set(skill.slug, existing!._id as Types.ObjectId);
    }

    const referenced = Array.from(new Set(skills.map((skill) => skill.slug)));
    if (referenced.length) {
      const destinationSkills = await this.skillModel
        .find({ slug: { $in: referenced }, createdBy: ownerId })
        .session(session)
        .exec();
      destinationSkills.forEach((skill) => ids.set(skill.slug, skill._id as Types.ObjectId));
    }
    return ids;
  }

  private async importConnectors(
    connectors: CatalogConnectorRecord[],
    ownerId: Types.ObjectId,
    categoryIds: Map<string, Types.ObjectId>,
    skillIds: Map<string, Types.ObjectId>,
    conflictPolicy: CatalogConflictPolicy,
    session: ClientSession,
    result: CatalogImportResult,
  ): Promise<void> {
    for (const connector of connectors) {
      const existing = await this.connectorModel
        .findOne({ slug: connector.slug, createdBy: ownerId })
        .session(session)
        .exec();
      const missingSkills = connector.referencedSkillSlugs.filter((slug) => !skillIds.has(slug));
      if (missingSkills.length) {
        const existingSkills = await this.skillModel
          .find({ slug: { $in: missingSkills }, createdBy: ownerId })
          .session(session)
          .exec();
        existingSkills.forEach((skill) => skillIds.set(skill.slug, skill._id as Types.ObjectId));
      }
      const unresolved = connector.referencedSkillSlugs.filter((slug) => !skillIds.has(slug));
      if (unresolved.length) {
        throw new BadRequestException(
          ErrorCode.BAD_REQUEST,
          `Connector '${connector.slug}' references missing skills: ${unresolved.join(', ')}.`,
        );
      }
      const data = {
        ...connector,
        runtimeAuthConfig: this.restoreRedactedValues(
          connector.runtimeAuthConfig,
          existing?.runtimeAuthConfig ?? {},
        ),
        mcpServerConfig: this.restoreRedactedValues(
          connector.mcpServerConfig,
          existing?.mcpServerConfig ?? {},
        ),
        categoryId: connector.categoryName ? categoryIds.get(connector.categoryName) ?? null : null,
        referencedSkillIds: connector.referencedSkillSlugs.map((slug) => skillIds.get(slug)),
        createdBy: ownerId,
      } as Record<string, unknown>;
      delete data.categoryName;
      delete data.referencedSkillSlugs;
      if (existing && conflictPolicy === 'skip') {
        result.connectors.skipped += 1;
      } else if (existing) {
        await this.connectorModel.findByIdAndUpdate(existing._id, { $set: data }, { session }).exec();
        result.connectors.updated += 1;
      } else {
        await this.connectorModel.create([data], { session });
        result.connectors.created += 1;
      }
    }
  }

  private async importSecurity(
    archive: CatalogArchiveV1,
    ownerId: Types.ObjectId,
    conflictPolicy: CatalogConflictPolicy,
    session: ClientSession,
    result: CatalogImportResult,
  ): Promise<void> {
    const security = archive.security!;
    for (const definition of security.connectedAppDefinitions) {
      const encrypted = {
        ...definition,
        clientId: this.cryptoService.encrypt(definition.clientId),
        clientSecret: this.cryptoService.encrypt(definition.clientSecret),
        tenantId: definition.tenantId ? this.cryptoService.encrypt(definition.tenantId) : undefined,
      };
      const existing = await this.appDefinitionModel.findOne({ appKey: definition.appKey }).session(session).exec();
      if (!existing) {
        await this.appDefinitionModel.create([encrypted], { session });
        result.security.connectedApps += 1;
      } else if (conflictPolicy === 'overwrite') {
        await this.appDefinitionModel.updateOne({ _id: existing._id }, { $set: encrypted }, { session }).exec();
        result.security.connectedApps += 1;
      }
    }
    for (const connection of security.userAppConnections) {
      const data = this.encryptTokenRecord(connection, ownerId);
      await this.appConnectionModel.updateOne(
        { userId: ownerId, appKey: connection.appKey },
        conflictPolicy === 'overwrite' ? { $set: data } : { $setOnInsert: data },
        { upsert: true, session },
      ).exec();
      result.security.tokens += 1;
    }
    for (const auth of security.adminConnectorAuth) {
      const data = this.encryptTokenRecord(auth, ownerId);
      await this.adminAuthModel.updateOne(
        { userId: ownerId, appKey: auth.appKey },
        conflictPolicy === 'overwrite' ? { $set: data } : { $setOnInsert: data },
        { upsert: true, session },
      ).exec();
      result.security.tokens += 1;
    }
    for (const credential of security.connectorCredentials) {
      const connector = await this.connectorModel
        .findOne({ slug: credential.connectorSlug, createdBy: ownerId })
        .session(session)
        .exec();
      if (!connector) continue;
      const data = {
        ...credential,
        connectorId: connector._id,
        userId: ownerId,
        lastValidatedAt: this.optionalDate(credential.lastValidatedAt),
        expiresAt: this.optionalDate(credential.expiresAt),
      } as Record<string, unknown>;
      delete data.connectorSlug;
      await this.credentialModel.updateOne(
        { connectorId: connector._id, userId: ownerId, displayName: credential.displayName },
        conflictPolicy === 'overwrite' ? { $set: data } : { $setOnInsert: data },
        { upsert: true, session },
      ).exec();
      result.security.credentials += 1;
    }
  }

  private encryptTokenRecord(record: Record<string, any>, ownerId: Types.ObjectId): Record<string, unknown> {
    return {
      ...record,
      userId: ownerId,
      accessToken: record.accessToken ? this.cryptoService.encrypt(record.accessToken) : undefined,
      refreshToken: record.refreshToken ? this.cryptoService.encrypt(record.refreshToken) : undefined,
      tokenExpiresAt: this.optionalDate(record.tokenExpiresAt),
      disconnectedAt: this.optionalDate(record.disconnectedAt),
      lastUsedAt: this.optionalDate(record.lastUsedAt),
      lastRefreshedAt: this.optionalDate(record.lastRefreshedAt),
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
      referencedSkillSlugs: (connector.referencedSkillIds ?? [])
        .map((id: Types.ObjectId) => skillSlugById.get(id.toString()))
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
    if (dto.selection === 'selected' && (!dto.ids?.length || dto.ids.some((id) => !Types.ObjectId.isValid(id)))) {
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

  private categoryNameMap(categories: Array<Record<string, any>>): Map<string, string> {
    return new Map(categories.map((category) => [category._id.toString(), category.name]));
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
