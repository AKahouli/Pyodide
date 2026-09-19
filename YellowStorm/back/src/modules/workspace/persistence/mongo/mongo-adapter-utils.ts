import type { DocumentFilter } from '../../ports/document-filter';
import { Types } from 'mongoose';

/**
 * Shared helpers for the Mongo port adapters. Filters translate field-by-field;
 * ids arrive as 24-hex strings and are cast for Mongo queries.
 */

export function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

export function mapFilter(filter: DocumentFilter): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (filter.id) query._id = toObjectId(filter.id);
  if (filter.workspaceId) query.workspaceId = toObjectId(filter.workspaceId);
  if (filter.workspaceIds?.length) query.workspaceId = { $in: filter.workspaceIds.map(toObjectId) };
  if (filter.ids?.length) query._id = { $in: filter.ids.map(toObjectId) };
  if (filter.status) query.status = filter.status;
  if (filter.indexingStatus) query.indexingStatus = filter.indexingStatus;
  if (filter.indexingStartedBefore) query.indexingStartedAt = { $lt: filter.indexingStartedBefore };
  if (filter.parentId) query.parentId = toObjectId(filter.parentId);
  if (filter.isFolder !== undefined) query.isFolder = filter.isFolder;
  if (filter.type) query.type = filter.type;
  if (filter.originalName) query.originalName = filter.originalName;
  if (filter.originalNameSearch) {
    query.originalName = { $regex: escapeRegex(filter.originalNameSearch), $options: 'i' };
  }
  if (filter.afterId) query._id = { ...(query._id as Record<string, unknown> | undefined), $gt: toObjectId(filter.afterId) };
  return query;
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mapSort(field: 'createdAt' | 'id', direction: 'asc' | 'desc'): Record<string, 1 | -1> {
  if (field === 'id') return { _id: direction === 'asc' ? 1 : -1 };
  return { createdAt: direction === 'asc' ? 1 : -1 };
}
