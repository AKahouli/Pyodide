import { Injectable } from '@nestjs/common';
import {
  type FlowReplayOutputContract,
  FlowReplayOutputContractType,
} from '../schemas/playbook-flow-validated-replay.schema';

export interface OutputContractValidationResult {
  evaluated: boolean;
  passed: boolean;
  score: number | null;
  reasons: string[];
}

@Injectable()
export class PlaybookFlowOutputContractService {
  buildOutputContractFromReplay(params: {
    output: unknown;
    preserveOutputFormat: boolean;
    outputFormatGuide: string | null;
    existingOutputContract: FlowReplayOutputContract | null;
  }): FlowReplayOutputContract | null {
    if (
      params.preserveOutputFormat
      && params.existingOutputContract?.type === FlowReplayOutputContractType.JSON_SCHEMA
      && typeof params.output === 'string'
    ) {
      return {
        ...params.existingOutputContract,
        citationPolicy: this.detectCitationPolicy(params.outputFormatGuide, params.output),
      };
    }

    const derivedContract = this.buildOutputContract(
      params.output,
      params.preserveOutputFormat,
      params.outputFormatGuide,
    );

    if (params.outputFormatGuide && derivedContract?.type === FlowReplayOutputContractType.FREEFORM) {
      return {
        ...derivedContract,
        citationPolicy: this.detectCitationPolicy(params.outputFormatGuide, params.output),
      };
    }

    return derivedContract ?? (params.preserveOutputFormat ? params.existingOutputContract ?? null : null);
  }

  buildOutputContract(
    output: unknown,
    preserveOutputFormat: boolean,
    outputFormatGuide: string | null,
  ): FlowReplayOutputContract | null {
    if (preserveOutputFormat) {
      const jsonSchema = this.buildJsonSchema(output);
      if (jsonSchema) {
        return {
          type: FlowReplayOutputContractType.JSON_SCHEMA,
          requiredSections: [],
          forbiddenSections: [],
          jsonSchema,
          citationPolicy: 'optional' as const,
        };
      }
    }

    const requiredSections = this.extractMarkdownSections(output);
    if (requiredSections.length > 0) {
      return {
        type: FlowReplayOutputContractType.MARKDOWN_SECTIONS,
        requiredSections,
        forbiddenSections: [],
        jsonSchema: null,
        citationPolicy: this.detectCitationPolicy(outputFormatGuide, output),
      };
    }

    if (!outputFormatGuide && !preserveOutputFormat) {
      return null;
    }

    return {
      type: FlowReplayOutputContractType.FREEFORM,
      requiredSections: [],
      forbiddenSections: [],
      jsonSchema: null,
      citationPolicy: this.detectCitationPolicy(outputFormatGuide, output),
    };
  }

  validateOutputContract(params: {
    output: unknown;
    outputContract: FlowReplayOutputContract | null;
  }): OutputContractValidationResult {
    if (!params.outputContract) {
      return { evaluated: false, passed: false, score: null, reasons: [] };
    }

    const reasons: string[] = [];
    let passedChecks = 0;
    let totalChecks = 0;

    if (params.outputContract.type === FlowReplayOutputContractType.JSON_SCHEMA) {
      const jsonResult = this.validateJsonSchema(params.output, params.outputContract);
      reasons.push(...jsonResult.reasons);
      passedChecks += jsonResult.passedChecks;
      totalChecks += jsonResult.totalChecks;
    }

    if (params.outputContract.type === FlowReplayOutputContractType.MARKDOWN_SECTIONS) {
      const markdownResult = this.validateMarkdownSections(params.output, params.outputContract);
      reasons.push(...markdownResult.reasons);
      passedChecks += markdownResult.passedChecks;
      totalChecks += markdownResult.totalChecks;
    }

    const citationResult = this.validateCitationPolicy(params.output, params.outputContract);
    reasons.push(...citationResult.reasons);
    passedChecks += citationResult.passedChecks;
    totalChecks += citationResult.totalChecks;

    if (totalChecks === 0) {
      return {
        evaluated: true,
        passed: true,
        score: 100,
        reasons: [],
      };
    }

    const score = Math.round((passedChecks / totalChecks) * 1000) / 10;
    return {
      evaluated: true,
      passed: reasons.length === 0,
      score,
      reasons,
    };
  }

  private validateJsonSchema(output: unknown, contract: FlowReplayOutputContract) {
    const schema = contract.jsonSchema as Record<string, unknown> | null;
    const parsed = this.parseObjectOutput(output);
    const reasons: string[] = [];
    let passedChecks = 0;
    let totalChecks = 0;

    totalChecks += 1;
    if (!parsed || Array.isArray(parsed)) {
      reasons.push('json_object_required');
      return { reasons, passedChecks, totalChecks };
    }
    passedChecks += 1;

    const requiredKeys = Array.isArray(schema?.required) ? schema.required : [];
    for (const key of requiredKeys) {
      totalChecks += 1;
      if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(parsed, key)) {
        passedChecks += 1;
      } else if (typeof key === 'string') {
        reasons.push(`missing_required_key:${key}`);
      }
    }

    const properties = schema?.properties && typeof schema.properties === 'object'
      ? schema.properties as Record<string, unknown>
      : {};
    for (const [key, value] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
        continue;
      }

      const propertyType = value && typeof value === 'object'
        ? (value as Record<string, unknown>).type
        : null;
      if (typeof propertyType !== 'string') {
        continue;
      }

      totalChecks += 1;
      if (this.resolveJsonType(parsed[key]) === propertyType) {
        passedChecks += 1;
      } else {
        reasons.push(`invalid_type:${key}:${propertyType}`);
      }
    }

    return { reasons, passedChecks, totalChecks };
  }

  private validateMarkdownSections(output: unknown, contract: FlowReplayOutputContract) {
    const headings = new Set(this.extractMarkdownSections(output).map((value) => this.normalizeHeading(value)));
    const reasons: string[] = [];
    let passedChecks = 0;
    let totalChecks = 0;

    for (const section of contract.requiredSections || []) {
      const normalized = this.normalizeHeading(section);
      totalChecks += 1;
      if (headings.has(normalized)) {
        passedChecks += 1;
      } else {
        reasons.push(`missing_required_section:${section}`);
      }
    }

    for (const section of contract.forbiddenSections || []) {
      const normalized = this.normalizeHeading(section);
      totalChecks += 1;
      if (!headings.has(normalized)) {
        passedChecks += 1;
      } else {
        reasons.push(`forbidden_section_present:${section}`);
      }
    }

    return { reasons, passedChecks, totalChecks };
  }

  private validateCitationPolicy(output: unknown, contract: FlowReplayOutputContract) {
    if (contract.citationPolicy === 'optional') {
      return { reasons: [], passedChecks: 0, totalChecks: 0 };
    }

    const containsCitations = this.hasCitationMarkers(output);
    const totalChecks = 1;
    if (contract.citationPolicy === 'required') {
      return containsCitations
        ? { reasons: [], passedChecks: 1, totalChecks }
        : { reasons: ['citation_required'], passedChecks: 0, totalChecks };
    }

    return containsCitations
      ? { reasons: ['citation_forbidden'], passedChecks: 0, totalChecks }
      : { reasons: [], passedChecks: 1, totalChecks };
  }

  private buildJsonSchema(output: unknown): Record<string, unknown> | null {
    const value = output;
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return null;
    }

    const properties = Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, entry]) => {
      acc[key] = { type: this.resolveJsonType(entry) };
      return acc;
    }, {});

    return {
      type: 'object',
      properties,
      required: Object.keys(properties),
    };
  }

  private extractMarkdownSections(output: unknown): string[] {
    if (typeof output !== 'string') {
      return [];
    }

    const matches = output.matchAll(/^#{1,6}\s+(.+)$/gm);
    const headings = Array.from(matches, (match) => match[1].trim()).filter(Boolean);
    return headings.filter((value, index, items) => items.indexOf(value) === index);
  }

  private detectCitationPolicy(outputFormatGuide: string | null, output: unknown): 'required' | 'optional' | 'forbidden' {
    const guide = (outputFormatGuide ?? '').toLowerCase();
    const hasExplicitBan = /\b(no|without|avoid|omit)\s+(citations?|references?|sources?)\b/.test(guide);
    if (hasExplicitBan) {
      return 'forbidden';
    }

    const hasCitations = this.hasCitationMarkers(output);
    const hasExplicitRequirement = /\b(include|add|provide|list|show|use|with|cite|citing|must include|should include)\b[\s\S]*\b(citations?|references?|sources?)\b/.test(guide)
      || /\b(citations?|references?|sources?)\b[\s\S]*\b(required|required for|per section|for each section)\b/.test(guide);

    if (hasCitations && (hasExplicitRequirement || !outputFormatGuide)) {
      return 'required';
    }

    return 'optional';
  }

  private resolveJsonType(value: unknown): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    switch (typeof value) {
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'object':
        return 'object';
      default:
        return 'string';
    }
  }

  private parseObjectOutput(output: unknown): Record<string, unknown> | null {
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      return output as Record<string, unknown>;
    }
    if (typeof output !== 'string') {
      return null;
    }

    try {
      const parsed = JSON.parse(output);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  private hasCitationMarkers(output: unknown): boolean {
    const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
    return /\[[0-9]+\]|\[[^\]]+\]\([^)]+\)|https?:\/\//i.test(text);
  }

  private normalizeHeading(value: string): string {
    return value.trim().toLowerCase();
  }
}
