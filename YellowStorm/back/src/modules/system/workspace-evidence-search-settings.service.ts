import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConnectorService } from '../connector/connector.service';
import { SystemSetting, SystemSettingDocument } from './schemas/system-setting.schema';
import type {
  WorkspaceEvidenceSearchConnectorOption,
  WorkspaceEvidenceSearchSettings,
  WorkspaceEvidenceSearchSettingsValue,
} from './interfaces/workspace-evidence-search-settings.interface';

const KEY = 'workspace_evidence_search';

@Injectable()
export class WorkspaceEvidenceSearchSettingsService {
  constructor(@InjectModel(SystemSetting.name) private readonly settings: Model<SystemSettingDocument>, private readonly connectors: ConnectorService) {}

  async getSettings(): Promise<WorkspaceEvidenceSearchSettings> {
    const setting = await this.settings.findOne({ key: KEY }).lean().exec();
    const value = setting?.value as Partial<WorkspaceEvidenceSearchSettingsValue> | undefined;
    return { connectorId: typeof value?.connectorId === 'string' ? value.connectorId : null, updatedAt: setting?.updatedAt as Date | undefined };
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
    const updated = await this.settings.findOneAndUpdate({ key: KEY }, { key: KEY, value: { connectorId } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean().exec();
    return { connectorId, updatedAt: updated?.updatedAt as Date | undefined };
  }
}
