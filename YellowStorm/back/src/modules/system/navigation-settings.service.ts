import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SYSTEM_SETTING_STORE, type SystemSettingStore } from './persistence/system-setting.store';
import {
  DEFAULT_NAVIGATION_SETTINGS,
  NAVIGATION_TARGET_KEYS,
  NavigationNode,
  NavigationSettings,
} from './interfaces/navigation-settings.interface';

const KEY = 'navigation_settings';
const MAX_DEPTH = 3;
const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

@Injectable()
export class NavigationSettingsService {
  constructor(
    @Inject(SYSTEM_SETTING_STORE)
    private readonly settings: SystemSettingStore,
  ) {}

  async getSettings(): Promise<NavigationSettings> {
    const setting = await this.settings.get(KEY);
    if (this.isSettings(setting?.value)) {
      try {
        const value = this.normalizePersistedSettings(setting.value);
        this.validate(value.nodes);
        return value;
      } catch {
        // Invalid persisted configuration must not make navigation unusable.
      }
    }
    return structuredClone(DEFAULT_NAVIGATION_SETTINGS);
  }

  async updateSettings(nodes: NavigationNode[]): Promise<NavigationSettings> {
    const normalizedNodes = this.normalizeNodes(nodes);
    this.validate(normalizedNodes);
    const current = await this.getSettings();
    const value = { revision: current.revision + 1, nodes: normalizedNodes };
    await this.settings.upsert(KEY, value);
    return value;
  }

  private validate(nodes: NavigationNode[]): void {
    if (!Array.isArray(nodes) || nodes.length > 100) {
      throw new BadRequestException('Navigation must contain at most 100 nodes');
    }
    for (const node of nodes) this.validateNodeShape(node);

    const ids = new Set(nodes.map((node) => node.id));
    if (ids.size !== nodes.length) throw new BadRequestException('Navigation node ids must be unique');

    const targets = nodes.filter((node) => node.targetKey).map((node) => node.targetKey);
    if (new Set(targets).size !== targets.length) {
      throw new BadRequestException('Each navigation target can only be mapped once');
    }

    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) {
      if (!node.labels.en.trim() || !node.labels.fr.trim()) {
        throw new BadRequestException('Navigation labels are required in English and French');
      }
      if (node.type === 'item' && !node.targetKey) {
        throw new BadRequestException(`Navigation item ${node.id} requires a target`);
      }
      if (node.type === 'group' && node.targetKey) {
        throw new BadRequestException(`Navigation group ${node.id} cannot have a target`);
      }
      if (node.targetKey && !NAVIGATION_TARGET_KEYS.includes(node.targetKey)) {
        throw new BadRequestException(`Unknown navigation target: ${node.targetKey}`);
      }
      if (node.parentId && (!byId.has(node.parentId) || byId.get(node.parentId)?.type !== 'group')) {
        throw new BadRequestException(`Invalid navigation parent for ${node.id}`);
      }

      const ancestors = new Set([node.id]);
      let parentId = node.parentId;
      while (parentId) {
        if (ancestors.has(parentId)) throw new BadRequestException('Navigation tree cannot contain cycles');
        ancestors.add(parentId);
        if (ancestors.size > MAX_DEPTH + 1) throw new BadRequestException(`Navigation depth cannot exceed ${MAX_DEPTH}`);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
    }
  }

  private validateNodeShape(node: unknown): asserts node is NavigationNode {
    if (!node || typeof node !== 'object') throw new BadRequestException('Invalid navigation node');
    const value = node as NavigationNode;
    if (typeof value.id !== 'string' || !NODE_ID_PATTERN.test(value.id)) {
      throw new BadRequestException('Invalid navigation node id');
    }
    if (value.type !== 'group' && value.type !== 'item') throw new BadRequestException('Invalid navigation node type');
    if (value.parentId !== null && typeof value.parentId !== 'string') throw new BadRequestException('Navigation parent must be explicit');
    if (!Number.isInteger(value.position) || value.position < 0) throw new BadRequestException('Invalid navigation position');
    if (typeof value.visible !== 'boolean') throw new BadRequestException('Invalid navigation visibility');
    if (typeof value.launcherVisible !== 'boolean') throw new BadRequestException('Invalid launcher visibility');
    if (!value.labels || typeof value.labels !== 'object'
      || typeof value.labels.en !== 'string' || value.labels.en.length > 80
      || typeof value.labels.fr !== 'string' || value.labels.fr.length > 80) {
      throw new BadRequestException('Invalid navigation labels');
    }
    if (value.targetKey !== undefined && (typeof value.targetKey !== 'string'
      || !NAVIGATION_TARGET_KEYS.includes(value.targetKey as (typeof NAVIGATION_TARGET_KEYS)[number]))) {
      throw new BadRequestException('Invalid navigation target');
    }
  }

  private normalizePersistedSettings(value: NavigationSettings): NavigationSettings {
    return {
      revision: value.revision,
      nodes: this.normalizeNodes(value.nodes),
    };
  }

  private normalizeNodes(nodes: NavigationNode[]): NavigationNode[] {
    return nodes.map((node) => {
        const normalized = { ...node } as NavigationNode & { targetKey?: NavigationNode['targetKey'] | null };
        if (normalized.targetKey === null) delete normalized.targetKey;
        if (normalized.launcherVisible === undefined) normalized.launcherVisible = true;
        return normalized;
      });
  }

  private isSettings(value: unknown): value is NavigationSettings {
    return Boolean(
      value &&
      typeof value === 'object' &&
      Number.isInteger((value as NavigationSettings).revision) &&
      (value as NavigationSettings).revision >= 0 &&
      Array.isArray((value as NavigationSettings).nodes),
    );
  }
}
