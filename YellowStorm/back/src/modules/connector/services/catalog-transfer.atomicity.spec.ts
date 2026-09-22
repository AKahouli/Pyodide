import { and, eq, inArray } from 'drizzle-orm';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { CatalogTransferService } from './catalog-transfer.service';
import { PgUserAppConnectionStore, PgConnectedAppDefinitionStore } from '../../connected-app/persistence/pg-connected-app.store';
import {
  PgConnectorAdminAuthStore,
  PgConnectorCategoryStore,
  PgConnectorCredentialStore,
  PgConnectorStore,
} from '../persistence/pg-connector.store';
import { PgSkillCategoryStore, PgSkillStore } from '../../skill/persistence/pg-skill.store';
import { PgUserStore } from '../../user/persistence/pg-user.store';
import type { CatalogArchiveV1 } from '../interfaces/catalog-transfer.interface';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

jest.setTimeout(60000);

/**
 * 3.6 / 3.7: catalog import is ONE transaction — a failure in the security
 * step must roll back the categories, skills and connectors written earlier.
 */
describeIntegration('CatalogTransferService import atomicity (integration)', () => {
  const { db, close } = makeTestDb();
  const crypto = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.replace(/^enc:/, '') };
  const adminAuthStore = new PgConnectorAdminAuthStore(db as never);
  const appConnectionStore = new PgUserAppConnectionStore(db as never);
  const service = new CatalogTransferService(
    new PgConnectorStore(db as never),
    new PgConnectorCategoryStore(db as never),
    new PgConnectorCredentialStore(db as never),
    adminAuthStore,
    new PgSkillStore(db as never),
    new PgSkillCategoryStore(db as never),
    new PgConnectedAppDefinitionStore(db as never),
    appConnectionStore,
    db as unknown as NodePgDatabase<typeof schema>,
    crypto as never,
  );

  const suffix = newObjectId().slice(-8);
  const APP_KEY = `spec-app-${suffix}`;
  const DEFINITION_ID = newObjectId();
  const SKILL_CAT = `spec-skillcat-${suffix}`;
  const CONN_CAT = `spec-conncat-${suffix}`;
  const SKILL_SLUG = `spec-skill-${suffix}`;
  const CONN_SLUG = `spec-conn-${suffix}`;
  let ownerId: string;
  let userId: string;

  const archive = (): CatalogArchiveV1 => ({
    format: 'yellowstorm-catalog',
    version: 1,
    resource: 'connectors',
    exportedAt: new Date().toISOString(),
    securityIncluded: true,
    skillCategories: [{ name: SKILL_CAT, description: 'd', isSystem: false }],
    connectorCategories: [{ name: CONN_CAT, description: 'd', isSystem: false }],
    skills: [{
      slug: SKILL_SLUG, name: `Spec Skill ${suffix}`, description: 'd', icon: '', color: '', iconColor: 'light',
      categoryName: SKILL_CAT, license: '', compatibility: '', metadata: {}, allowedTools: [],
      instructions: 'do', files: [], isActive: true,
    }],
    connectors: [{
      slug: CONN_SLUG, name: `Spec Conn ${suffix}`, description: 'd', icon: '', color: '', iconColor: 'light',
      categoryName: CONN_CAT, authType: 'none', authConfigSchema: {}, authSourceType: 'credential',
      connectedAppKey: '', runtimeAuthConfig: {}, mcpTransportType: 'streamable_http', mcpServerUrl: '',
      mcpServerConfig: {}, dynamicHeaders: [], actions: [], referencedSkillSlugs: [SKILL_SLUG],
      isActive: true, isSystem: false, isHidden: false,
    }],
    security: {
      connectorCredentials: [],
      connectedAppDefinitions: [],
      userAppConnections: [{
        appKey: APP_KEY, accessToken: 'a', refreshToken: 'r', tokenExpiresAt: null, scopes: [],
        providerAccountId: 'p', providerEmail: 'e@example.test', status: 'active',
        lastUsedAt: null, lastRefreshedAt: null, errorMessage: '',
      }],
      adminConnectorAuth: [{
        appKey: APP_KEY, accessToken: 'a', refreshToken: 'r', tokenExpiresAt: null, scopes: [],
        providerAccountId: 'p', providerEmail: 'e@example.test', connected: true, status: 'active',
        disconnectedAt: null, lastUsedAt: null, lastRefreshedAt: null, errorMessage: '',
      }],
    },
  });

  const counts = async () => ({
    skillCats: (await db.select().from(schema.catalogSkillCategories).where(eq(schema.catalogSkillCategories.name, SKILL_CAT))).length,
    skills: (await db.select().from(schema.catalogSkills).where(eq(schema.catalogSkills.createdBy, ownerId))).length,
    connCats: (await db.select().from(schema.integrationsConnectorCategories).where(eq(schema.integrationsConnectorCategories.createdBy, ownerId))).length,
    connectors: (await db.select().from(schema.integrationsConnectors).where(eq(schema.integrationsConnectors.createdBy, ownerId))).length,
    userConns: (await db.select().from(schema.integrationsUserAppConnections).where(eq(schema.integrationsUserAppConnections.userId, userId))).length,
    adminAuth: (await db.select().from(schema.integrationsAdminConnectorAuthTokens).where(eq(schema.integrationsAdminConnectorAuthTokens.userId, ownerId))).length,
  });

  const cleanup = async () => {
    const conns = await db.select({ id: schema.integrationsConnectors.id }).from(schema.integrationsConnectors)
      .where(eq(schema.integrationsConnectors.createdBy, ownerId));
    if (conns.length) {
      await db.delete(schema.integrationsConnectors).where(inArray(schema.integrationsConnectors.id, conns.map((c) => c.id)));
    }
    await db.delete(schema.catalogSkills).where(eq(schema.catalogSkills.createdBy, ownerId));
    await db.delete(schema.integrationsConnectorCategories).where(eq(schema.integrationsConnectorCategories.createdBy, ownerId));
    await db.delete(schema.catalogSkillCategories).where(eq(schema.catalogSkillCategories.name, SKILL_CAT));
    await db.delete(schema.integrationsUserAppConnections).where(and(
      eq(schema.integrationsUserAppConnections.userId, userId),
      eq(schema.integrationsUserAppConnections.appKey, APP_KEY),
    ));
    await db.delete(schema.integrationsAdminConnectorAuthTokens).where(eq(schema.integrationsAdminConnectorAuthTokens.appKey, APP_KEY));
  };

  beforeAll(async () => {
    ownerId = newObjectId();
    await db.execute(
      `INSERT INTO integrations.connected_app_definitions
         (id, app_key, display_name, authorization_url, token_url, client_id, client_secret, scopes)
       VALUES ('${DEFINITION_ID}', '${APP_KEY}', 'Spec', 'https://auth', 'https://token', 'c', 's', '{}')`,
    );
    const user = await new PgUserStore(db as never).create({
      email: `spec-atomic-${suffix}@example.com`, passwordHash: 'h', emailVerified: true, status: 'active',
    } as never);
    userId = user.id;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await cleanup();
  });

  afterAll(async () => {
    await db.execute(`DELETE FROM integrations.connected_app_definitions WHERE id = '${DEFINITION_ID}'`);
    await db.execute(`DELETE FROM identity.users WHERE id = '${userId}'`);
    await close();
  });

  it('control: a successful import persists everything', async () => {
    // userConns are keyed by the importing user, so import as the real user.
    ownerId = userId;
    const res = await service.importArchive(userId, archive(), 'skip');
    expect(res.skills.created).toBe(1);
    expect(res.connectors.created).toBe(1);
    expect(await counts()).toEqual({ skillCats: 1, skills: 1, connCats: 1, connectors: 1, userConns: 1, adminAuth: 1 });
  });

  it('rolls back categories, skills, connectors and earlier security rows when a later step throws', async () => {
    ownerId = userId;
    expect(await counts()).toEqual({ skillCats: 0, skills: 0, connCats: 0, connectors: 0, userConns: 0, adminAuth: 0 });
    jest.spyOn(adminAuthStore, 'insertForImport').mockRejectedValueOnce(new Error('boom-after-connectors'));

    await expect(service.importArchive(userId, archive(), 'skip')).rejects.toThrow('boom-after-connectors');

    expect(await counts()).toEqual({ skillCats: 0, skills: 0, connCats: 0, connectors: 0, userConns: 0, adminAuth: 0 });
  });

  it('rolls back skills/categories when the connectors step throws', async () => {
    ownerId = userId;
    const bad = archive();
    bad.connectors[0].referencedSkillSlugs = ['spec-missing-skill'];
    await expect(service.importArchive(userId, bad, 'skip')).rejects.toThrow(/missing skills/);
    expect(await counts()).toEqual({ skillCats: 0, skills: 0, connCats: 0, connectors: 0, userConns: 0, adminAuth: 0 });
  });
});
