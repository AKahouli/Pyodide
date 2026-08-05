import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../logger';
import { AgentRepository } from '../agent/repositories/agent.repository';
import { AgentType, AgentTypeDocument } from '../agent-type/schemas/agent-type.schema';
import { collapseRepeatedChar, collapseWhitespace, stripLeadingTrailingChar } from '../../common/utils';

/** Agent-type slug for the per-user "human" agent. Assumed created in the admin panel. */
const HUMAIN_AGENT_TYPE_SLUG = 'humain';

export interface HumainAgentInput {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  description?: string;
}

/** Mirror of the agent schema's slug derivation (kept local to avoid cross-module coupling). */
function deriveAgentSlug(value: string): string {
  return stripLeadingTrailingChar(
    collapseRepeatedChar(
      collapseWhitespace(
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim(),
        '-',
      ).replace(/[^a-z0-9-]/g, '-'),
      '-',
    ),
    '-',
  );
}

@Injectable()
export class HumainAgentService {
  constructor(
    private readonly agentRepository: AgentRepository,
    @InjectModel(AgentType.name) private readonly agentTypeModel: Model<AgentTypeDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(HumainAgentService.name);
  }

  /** Create the user's human agent if it does not exist yet. Does not modify an existing one. */
  async ensureForUser(input: HumainAgentInput): Promise<void> {
    await this.upsert(input, false);
  }

  /** Create the human agent if missing, and overwrite its name/role/description from the profile. */
  async syncFromProfile(input: HumainAgentInput): Promise<void> {
    await this.upsert(input, true);
  }

  private async upsert(input: HumainAgentInput, overwriteProfileFields: boolean): Promise<void> {
    try {
      const humainType = await this.agentTypeModel
        .findOne({ slug: HUMAIN_AGENT_TYPE_SLUG, isActive: true })
        .lean()
        .exec();
      if (!humainType) {
        this.logger.warn('Humain agent type not found; skipping human agent upsert', { userId: input.userId });
        return;
      }

      const agentType = String(humainType._id);
      const agentTypeSlug = String(humainType.slug ?? '');
      const name = this.deriveName(input);
      const slug = deriveAgentSlug(name);
      const role = this.deriveRole(input, name);
      const description = (input.description ?? '').slice(0, 1000);

      const existing = await this.agentRepository.findByOwnerAndType(input.userId, agentType);

      if (!existing) {
        await this.agentRepository.create({
          id: new Types.ObjectId().toString(),
          name, slug, agentType, agentTypeSlug, role, description,
          temperature: 0, llmModel: undefined, instruction: '', ignorePrePrompt: false,
          knowledgeBases: [], tools: [], skills: [], disabledSkills: [], connectors: [], connectorActionSelections: [],
          guardrails: {}, deploymentSettings: {},
          enable_temporary_child_agents: false, max_temporary_child_agents: 4,
          isDefault: false, isDefaultForType: false, isActive: true, createdBy: input.userId,
        });
        this.logger.log('Human agent created', { userId: input.userId });
        return;
      }

      if (overwriteProfileFields) {
        await this.agentRepository.updateById(existing._id, { name, slug, role, description });
        this.logger.log('Human agent synced', { userId: input.userId });
      }
    } catch (error) {
      // Never throw: human-agent maintenance must not break auth/profile flows.
      this.logger.warn('Failed to upsert human agent', { userId: input.userId, error: (error as Error).message });
    }
  }

  private deriveName(input: HumainAgentInput): string {
    const full = [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(' ').trim();
    let base = full || input.email.split('@')[0]?.trim() || 'User';
    if (base.length < 2) base = `${base}-agent`; // satisfy the 2-char minimum
    return base.slice(0, 50);
  }

  private deriveRole(input: HumainAgentInput, name: string): string {
    const role = input.role?.trim();
    if (role) return role.slice(0, 50000);
    return `You are ${name}, a human agent.`;
  }
}
