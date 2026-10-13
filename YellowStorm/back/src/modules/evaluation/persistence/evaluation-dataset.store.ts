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
  /** Null when the dataset does not exist OR belongs to someone else — the two are indistinguishable. */
  findByIdForCreator(id: string, userId: string): Promise<DatasetRecord | null>;
  /** No-op when the dataset belongs to someone else. */
  deleteByIdForCreator(id: string, userId: string): Promise<void>;
}
