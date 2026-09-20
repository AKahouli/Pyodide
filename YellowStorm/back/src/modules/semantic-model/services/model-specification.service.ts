import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  ConceptSpec,
  FieldFilter,
  FilterNode,
  ModelSpecification,
  SpecIssue,
} from '../domain/model-specification.types';

// P1.5: canonical immutable snapshot + specHash. P1.2/P1.4: reference/type
// validation before any population job is accepted. Stdlib only (crypto).
@Injectable()
export class ModelSpecificationService {
  buildSnapshot(input: Omit<ModelSpecification, 'specHash'>): ModelSpecification {
    const canonical = this.canonicalize({ ...input });
    return { ...canonical, specHash: this.hash(canonical) };
  }

  validate(input: Omit<ModelSpecification, 'specHash'>): SpecIssue[] {
    const issues: SpecIssue[] = [];
    const conceptIds = new Set<string>();
    const conceptKeys = new Set<string>();
    const fieldsByConcept = new Map<string, Set<string>>();

    for (const c of input.concepts ?? []) {
      if (conceptIds.has(c.conceptId))
        issues.push({ code: 'duplicate_concept_id', targetId: c.conceptId, message: 'Concept ids must be unique; rename preserves id.' });
      conceptIds.add(c.conceptId);
      const key = c.key.trim().toLowerCase();
      if (conceptKeys.has(key))
        issues.push({ code: 'duplicate_concept_key', targetId: c.conceptId, message: 'Concept keys must be unique.' });
      conceptKeys.add(key);
      const keyParts = c.identity?.keyComponents ?? [];
      if (!c.identity?.namespace?.trim() || !keyParts.length || keyParts.some((p) => !p?.trim()))
        issues.push({ code: 'empty_identity_key', targetId: c.conceptId, message: 'Identity needs a namespace and at least one non-blank key component.' });
      if (!c.allowedFields?.length)
        issues.push({ code: 'empty_allowed_fields', targetId: c.conceptId, message: 'Allowed fields must list at least one field.' });
      fieldsByConcept.set(c.conceptId, new Set(c.allowedFields ?? []));
      // P1.4: materialization is a subset selector, never a replacement for eligibility.
      if (c.materialization && !c.eligibility)
        issues.push({ code: 'materialization_without_eligibility', targetId: c.conceptId, message: 'Materialization filter requires an eligibility filter.' });
      this.checkFilter(c.eligibility, fieldsByConcept.get(c.conceptId)!, c.conceptId, issues);
      this.checkFilter(c.materialization, fieldsByConcept.get(c.conceptId)!, c.conceptId, issues);
    }

    const relationIds = new Set<string>();
    for (const r of input.relations ?? []) {
      if (relationIds.has(r.relationId))
        issues.push({ code: 'duplicate_relation_id', targetId: r.relationId, message: 'Relation ids must be unique.' });
      relationIds.add(r.relationId);
      // P1 acceptance: unsupported endpoint types rejected; declaration creates no instance edges.
      if (!conceptIds.has(r.sourceConceptId) || !conceptIds.has(r.targetConceptId))
        issues.push({ code: 'unknown_relation_endpoint', targetId: r.relationId, message: 'Relation endpoints must reference known concepts.' });
    }

    if (!input.sourceScope?.length)
      issues.push({ code: 'empty_source_scope', message: 'Source scope must not be empty.' });

    return issues;
  }

  private checkFilter(node: FilterNode | null | undefined, allowed: Set<string>, targetId: string, issues: SpecIssue[]): void {
    if (!node) return;
    if (this.isFieldFilter(node)) {
      if (!allowed.has(node.field))
        issues.push({ code: 'unknown_filter_field', targetId, message: `Filter field '${node.field}' is not in allowed fields.` });
      return;
    }
    for (const child of node.all ?? []) this.checkFilter(child, allowed, targetId, issues);
    for (const child of node.any ?? []) this.checkFilter(child, allowed, targetId, issues);
    if (node.not) this.checkFilter(node.not, allowed, targetId, issues);
  }

  private isFieldFilter(node: FilterNode): node is FieldFilter {
    return (node as Partial<FieldFilter>).field !== undefined;
  }

  private canonicalize(spec: Omit<ModelSpecification, 'specHash'>): Omit<ModelSpecification, 'specHash'> {
    const sortConcepts = [...(spec.concepts ?? [])]
      .map((c: ConceptSpec) => ({ ...c, allowedFields: [...c.allowedFields].sort() }))
      .sort((a, b) => a.conceptId.localeCompare(b.conceptId));
    const sortRelations = [...(spec.relations ?? [])].sort((a, b) => a.relationId.localeCompare(b.relationId));
    const sortScope = [...(spec.sourceScope ?? [])].sort((a, b) =>
      `${a.workspaceId}:${a.assetId}`.localeCompare(`${b.workspaceId}:${b.assetId}`),
    );
    return { ...spec, concepts: sortConcepts, relations: sortRelations, sourceScope: sortScope };
  }

  private hash(canonical: Omit<ModelSpecification, 'specHash'>): string {
    return `sha256:${createHash('sha256').update(this.stableStringify(canonical)).digest('hex')}`;
  }

  // ponytail: recursive key sort; arrays keep order (top-level sets are
  // pre-sorted in canonicalize). Upgrade to a canonical-JSON lib if spec grows.
  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map((v) => this.stableStringify(v)).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${this.stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
}
