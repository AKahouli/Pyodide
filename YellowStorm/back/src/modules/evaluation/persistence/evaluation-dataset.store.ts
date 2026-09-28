import type { DatasetItem, DatasetRecord } from '../evaluation.types';

/** Store port for agent_evaluation.datasets (roadmap P6). */

export interface CreateDatasetData {
  name: string;
  items: DatasetItem[];
  createdBy: string;
  workspaceId?: string;
}

export interface EvaluationDatasetStore {
  create(data: CreateDatasetData): Promise<DatasetRecord>;
  findByCreator(userId: string): Promise<DatasetRecord[]>;
  findById(id: string): Promise<DatasetRecord | null>;
  deleteById(id: string): Promise<void>;
}
