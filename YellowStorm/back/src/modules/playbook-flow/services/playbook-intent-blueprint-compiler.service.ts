import { Injectable, Logger } from '@nestjs/common';
import { PlaybookIntentBlueprintParserService } from './playbook-intent-blueprint-parser.service';
import { PlaybookIntentBlueprintRepairService } from './playbook-intent-blueprint-repair.service';
import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';
import { PlaybookIntentGraphBuilderService, type BuilderDesignCatalog } from './playbook-intent-graph-builder.service';
import { PlaybookIntentSuggestionDiagnosticsService } from './playbook-intent-suggestion-diagnostics.service';
import type { AvailableDesignCatalog, PlaybookIntentAnalysisContext, PlaybookIntentSuggestion } from './playbook-flow-intent.service';
import { PlaybookIntentExternalInputNormalizerService } from './playbook-intent-external-input-normalizer.service';

@Injectable()
export class PlaybookIntentBlueprintCompilerService {
  private readonly logger = new Logger(PlaybookIntentBlueprintCompilerService.name);

  constructor(
    private readonly blueprintParser: PlaybookIntentBlueprintParserService = new PlaybookIntentBlueprintParserService(),
    private readonly blueprintRepair: PlaybookIntentBlueprintRepairService = new PlaybookIntentBlueprintRepairService(),
    private readonly graphBuilder: PlaybookIntentGraphBuilderService = new PlaybookIntentGraphBuilderService(
      new PlaybookIntentGraphBindingResolverService(),
    ),
    private readonly suggestionDiagnostics: PlaybookIntentSuggestionDiagnosticsService = new PlaybookIntentSuggestionDiagnosticsService(),
    private readonly externalInputNormalizer: PlaybookIntentExternalInputNormalizerService = new PlaybookIntentExternalInputNormalizerService(),
  ) {}

  compile(args: { raw: string; context: PlaybookIntentAnalysisContext }): PlaybookIntentSuggestion[] {
    if (!this.blueprintParser.hasBlueprintShape(args.raw)) {
      this.logger.warn('playbook_intent_invalid_blueprint_output rule=missing_blueprint');
      return [];
    }

    const parsed = this.blueprintParser.parse(args.raw, args.context.validationContext);
    if (!parsed) {
      this.logger.warn('playbook_intent_invalid_blueprint_output rule=parse_failed');
      return [];
    }

    try {
      const designCatalog = this.buildGraphBuilderDesignCatalog(args.context.availableDesignCatalog);
      const repaired = this.blueprintRepair.repair({
        blueprint: parsed.blueprint,
        templates: args.context.nodeTemplates,
        designCatalog,
        existingContext: args.context.validationContext,
      });
      const built = this.graphBuilder.build({
        blueprint: repaired.blueprint,
        context: args.context.validationContext,
        limits: args.context.limits,
        templates: args.context.nodeTemplates,
        designCatalog,
        selectedNodeId: args.context.selectedNodeId,
      });
      const normalized = this.externalInputNormalizer.normalize(built.suggestion, args.context);
      const diagnostics = [...parsed.diagnostics, ...repaired.diagnostics, ...built.diagnostics, ...normalized.diagnostics];
      if (diagnostics.length) {
        this.logger.warn(`playbook_intent_builder_diagnostics items=${diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.itemId || ''}`).join(',')}`);
      }
      const suggestion = this.suggestionDiagnostics.enrichWorkflowPlan(normalized.suggestion, args.context.flow, diagnostics, repaired.repairSummary);
      if (suggestion.validationStatus === 'blocked') {
        const createdRefs = suggestion.changes.flatMap((change) => change.type === 'create_node' ? [change.nodeRef] : []).join(',');
        const edgeRefs = suggestion.changes.flatMap((change) => {
          if (change.type !== 'create_edge') return [];
          const edge = change as unknown as { sourceTaskId?: string | null; sourceNodeRef?: string | null; targetTaskId?: string | null; targetNodeRef?: string | null };
          return [`${edge.sourceTaskId || edge.sourceNodeRef}->${edge.targetTaskId || edge.targetNodeRef}`];
        }).join(',');
        const bindingRefs = suggestion.changes.flatMap((change) => {
          if (change.type !== 'create_data_binding') return [];
          const binding = change as unknown as { sourceTaskId?: string | null; sourceNodeRef?: string | null; sourceKind?: string; targetTaskId?: string | null; targetNodeRef?: string | null; targetPort?: string };
          return [`${binding.sourceTaskId || binding.sourceNodeRef || binding.sourceKind}=>${binding.targetTaskId || binding.targetNodeRef}.${binding.targetPort ?? '?'}`];
        }).join(',');
        this.logger.warn(`playbook_intent_blueprint_blocked nodes=[${createdRefs}] edges=[${edgeRefs}] bindings=[${bindingRefs}] rules=[${(suggestion.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => `${diagnostic.code}:${diagnostic.message}`).join(' | ')}]`);
      }
      return [suggestion];
    } catch (error) {
      this.logger.error(`playbook_intent_builder_failed message=${error instanceof Error ? error.message : 'unknown'}`);
      this.logger.warn('playbook_intent_invalid_blueprint_output rule=build_failed');
      return [];
    }
  }

  buildGraphBuilderDesignCatalog(catalog: AvailableDesignCatalog): BuilderDesignCatalog {
    return {
      connectors: catalog.availableConnectors.map((connector) => ({
        id: connector.id,
        slug: connector.connectorSlug,
        name: connector.name,
      })),
      connectorActions: catalog.availableConnectorActions.map((action) => ({
        connectorSlug: action.connectorSlug,
        actionKey: action.actionKey,
      })),
      skills: catalog.availableSkills.map((skill) => ({
        id: skill.id,
        slug: skill.skillSlug,
        name: skill.name,
      })),
    };
  }
}
