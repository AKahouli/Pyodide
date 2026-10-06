import { ForbiddenException } from '@nestjs/common';
import { Permissions } from '../authorization/constants/permissions';
import { AdminCatalogTransferController } from './admin-catalog-transfer.controller';

describe('AdminCatalogTransferController import permissions', () => {
  const controller = new AdminCatalogTransferController({} as never, {} as never);
  const authorize = (
    permissions: string[],
    archive: {
      connectors: unknown[];
      skills: unknown[];
      connectorCategories?: unknown[];
      skillCategories?: unknown[];
    },
    policy: 'skip' | 'overwrite' = 'skip',
  ) => { (controller as unknown as {
    assertImportPermissions(
      user: { permissions: string[] },
      value: {
        connectors: unknown[];
        skills: unknown[];
        connectorCategories: unknown[];
        skillCategories: unknown[];
      },
      conflictPolicy: 'skip' | 'overwrite',
    ): void;
  }).assertImportPermissions({ permissions }, {
    connectorCategories: [],
    skillCategories: [],
    ...archive,
  }, policy); };

  it('does not let a skill-only administrator import connectors', () => {
    expect(() => { authorize(
      [Permissions.SKILLS_CREATE],
      { connectors: [{}], skills: [] },
    ); }).toThrow(ForbiddenException);
  });

  it('requires both connector and skill permissions when the archive contains both', () => {
    expect(() => { authorize(
      [Permissions.CONNECTORS_CREATE],
      { connectors: [{}], skills: [{}] },
    ); }).toThrow(ForbiddenException);

    expect(() => { authorize(
      [Permissions.CONNECTORS_CREATE, Permissions.SKILLS_CREATE],
      { connectors: [{}], skills: [{}] },
    ); }).not.toThrow();
  });

  it('requires update permissions for overwrite imports', () => {
    expect(() => { authorize(
      [Permissions.CONNECTORS_CREATE],
      { connectors: [{}], skills: [] },
      'overwrite',
    ); }).toThrow(ForbiddenException);
  });

  it('requires resource permissions for category-only archives', () => {
    expect(() => { authorize(
      [Permissions.SKILLS_CREATE],
      { connectors: [], skills: [], connectorCategories: [{}] },
    ); }).toThrow(ForbiddenException);

    expect(() => { authorize(
      [Permissions.CONNECTORS_CREATE],
      { connectors: [], skills: [], connectorCategories: [{}] },
    ); }).not.toThrow();
  });
});
