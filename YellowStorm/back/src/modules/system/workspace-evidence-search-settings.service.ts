import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConnectorService } from '../connector/connector.service';
import { SYSTEM_SETTING_STORE, type SystemSettingStore } from './persistence/system-setting.store';
import type {
  WorkspaceEvidenceSearchConnectorOption,
  WorkspaceEvidenceSearchSettings,
  WorkspaceEvidenceSearchSettingsValue,
} from './interfaces/workspace-evidence-search-settings.interface';

const KEY = 'workspace_evidence_search';

@Injectable()
export class WorkspaceEvidenceSearchSettingsService {
  constructor(@Inject(SYSTEM_SETTING_STORE) private readonly settings: SystemSettingStore, private readonly connectors: ConnectorService) {}

  async getSettings(): Promise<WorkspaceEvidenceSearchSettings> {
    const setting = await this.settings.get(KEY);
    const value = setting?.value as Partial<WorkspaceEvidenceSearchSettingsValue> | undefined;
    return { connectorId: typeof value?.connectorId === 'string' ? value.connectorId : null, updatedAt: setting?.updatedAt };
  }

  async listActiveConnectorOptions(): Promise<WorkspaceEvidenceSearchConnectorOption[]> {
    const options: WorkspaceEvidenceSearchConnectorOption[] = [];
    const limit = 100;
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const activeConnectors = await this.connectors.findAll({ page, limit, isActive: true });
      options.push(...activeConnectors.data.map((connector) => ({ id: connector.id, name: connector.name })));
      totalPages = activeConnectors.meta.totalPages;
      page += 1;
    }

    return options;
  }

  async updateSettings(connectorId: string | null): Promise<WorkspaceEvidenceSearchSettings> {
    if (connectorId) {
      const connector = await this.connectors.findById(connectorId);
      if (!connector.isActive) throw new BadRequestException('The selected evidence search connector must be active');
    }
    const updated = await this.settings.upsert(KEY, { connectorId });
    return { connectorId, updatedAt: updated.updatedAt };
  }
}
