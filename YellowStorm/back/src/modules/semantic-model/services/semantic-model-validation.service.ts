import { Injectable } from '@nestjs/common';
import { AttributeDefinition, SemanticGraph, ValidationIssue } from '../domain/semantic-model.types';

@Injectable()
export class SemanticModelValidationService {
  validate(graph: SemanticGraph): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const recordById = new Map(graph.records.map((record) => [record.id, record]));
    const labels = new Map<string, string>([
      ...graph.nodes.map((node) => [node.id, node.label] as const),
      ...graph.relations.map((relation) => [relation.id, relation.label] as const),
      ...graph.records.map((record) => [record.id, record.label] as const),
    ]);

    this.findDuplicateKeys(graph.nodes, 'node_type', issues);
    this.findDuplicateKeys(graph.relations, 'relation_type', issues);

    for (const node of graph.nodes) {
      if (!node.description.trim() && !node.systemKey) {
        issues.push(this.issue('missing_description', 'warning', 'node_type', node.id, 'Add a short description so colleagues understand this business concept.'));
      }
      this.validateAttributes(node.attributes, node.id, issues);
      const connected = graph.relations.some((relation) => relation.sourceNodeTypeId === node.id || relation.targetNodeTypeId === node.id);
      if (!connected && graph.nodes.length > 1 && !node.systemKey) {
        issues.push(this.issue('isolated_node', 'warning', 'node_type', node.id, 'This concept is not connected to the rest of the model.'));
      }
      if (node.recordPolicy === 'expected' && !graph.records.some((record) => record.nodeTypeId === node.id)) {
        issues.push(this.issue('expected_records_missing', 'warning', 'node_type', node.id, 'This concept expects Business Records, but none have been added yet.'));
      }
    }

    for (const relation of graph.relations) {
      if (!nodeIds.has(relation.sourceNodeTypeId) || !nodeIds.has(relation.targetNodeTypeId)) {
        issues.push(this.issue('invalid_relation_endpoint', 'error', 'relation_type', relation.id, 'Choose valid concepts at both ends of this relationship.'));
      }
      this.validateAttributes(relation.attributes, relation.id, issues);
    }

    for (const record of graph.records) {
      const node = graph.nodes.find((candidate) => candidate.id === record.nodeTypeId);
      if (!node || node.recordPolicy === 'none') {
        issues.push(this.issue('record_policy_invalid', 'error', 'record', record.id, 'This concept does not allow Business Records.'));
        continue;
      }
      for (const attribute of node.attributes.filter((item) => item.required)) {
        if (record.values[attribute.key] === undefined || record.values[attribute.key] === '') {
          issues.push(this.issue('record_value_required', 'error', 'record', record.id, `${attribute.label} is required.`));
        }
      }
    }

    for (const relation of graph.recordRelations) {
      const type = graph.relations.find((candidate) => candidate.id === relation.relationTypeId);
      const source = recordById.get(relation.sourceRecordId);
      const target = recordById.get(relation.targetRecordId);
      if (!type || !source || !target || source.nodeTypeId !== type.sourceNodeTypeId || target.nodeTypeId !== type.targetNodeTypeId) {
        issues.push(this.issue('record_relation_incompatible', 'error', 'record', relation.id, 'The selected records do not match this relationship.'));
      }
    }
    return issues.map((issue) => {
      const label = issue.targetId ? labels.get(issue.targetId) : undefined;
      return label ? { ...issue, targetLabel: label } : issue;
    });
  }

  private findDuplicateKeys(
    entities: Array<{ id: string; key: string }>,
    kind: 'node_type' | 'relation_type',
    issues: ValidationIssue[],
  ): void {
    const seen = new Set<string>();
    for (const entity of entities) {
      const key = entity.key.trim().toLowerCase();
      if (seen.has(key)) issues.push(this.issue('duplicate_key', 'error', kind, entity.id, 'Keys must be unique in a model.'));
      seen.add(key);
    }
  }

  private validateAttributes(attributes: AttributeDefinition[], targetId: string, issues: ValidationIssue[]): void {
    const seen = new Set<string>();
    for (const attribute of attributes) {
      if (!/^[a-z][a-z0-9_]*$/.test(attribute.key)) {
        issues.push(this.issue('attribute_key_invalid', 'error', 'node_type', targetId, 'Attribute keys must start with a letter and use lowercase letters, numbers, or underscores.'));
      }
      if (seen.has(attribute.key)) issues.push(this.issue('attribute_key_duplicate', 'error', 'node_type', targetId, 'Attribute keys must be unique.'));
      seen.add(attribute.key);
    }
  }

  private issue(code: string, severity: 'error' | 'warning', targetKind: ValidationIssue['targetKind'], targetId: string, message: string): ValidationIssue {
    return { code, severity, targetKind, targetId, message };
  }
}
