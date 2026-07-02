import { Injectable, Logger } from '@nestjs/common';
import { PlaybookIntentBlueprintParserService } from './playbook-intent-blueprint-parser.service';
import { PlaybookIntentBlueprintRepairService } from './playbook-intent-blueprint-repair.service';
import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';
import { PlaybookIntentGraphBuilderService, type BuilderDesignCatalog } from './playbook-intent-graph-builder.service';
import { PlaybookIntentSuggestionDiagnosticsService } from './playbook-intent-suggestion-diagnostics.service';
import type { AvailableDesignCatalog, PlaybookIntentAnalysisContext, PlaybookIntentSuggestion } from './playbook-flow-intent.service';

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
  ) {}

  compile(args: { raw: string; context: PlaybookIntentAnalysisContext }): PlaybookIntentSuggestion[] {
    if (!this.blueprintParser.hasBlueprintShape(args.raw)) {
      this.logger.warn('playbook_intent_invalid_blueprint_output rule=missing_blueprint');
      return [];
    }

    const parsed = this.blueprintParser.parse(args.raw);
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
      const diagnostics = [...parsed.diagnostics, ...repaired.diagnostics, ...built.diagnostics];
      if (diagnostics.length) {
        this.logger.warn(`playbook_intent_builder_diagnostics items=${diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.itemId || ''}`).join(',')}`);
      }
      return [this.suggestionDiagnostics.enrichWorkflowPlan(built.suggestion, args.context.flow, diagnostics, repaired.repairSummary)];
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
