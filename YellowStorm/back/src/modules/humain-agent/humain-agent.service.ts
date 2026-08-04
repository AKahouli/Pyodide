import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../logger';
import { Agent, AgentDocument } from '../agent/schemas/agent.schema';
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
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
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

      const createdBy = new Types.ObjectId(input.userId);
      const agentType = humainType._id;
      const name = this.deriveName(input);
      const slug = deriveAgentSlug(name);
      const role = this.deriveRole(input, name);
      const description = (input.description ?? '').slice(0, 1000);

      const update = overwriteProfileFields
        ? { $set: { name, slug, role, description }, $setOnInsert: { createdBy, agentType } }
        : { $setOnInsert: { name, slug, role, description, createdBy, agentType } };

      await this.agentModel
        .findOneAndUpdate({ createdBy, agentType }, update, { upsert: true, new: true, setDefaultsOnInsert: true })
        .exec();

      this.logger.log('Human agent upserted', { userId: input.userId, overwriteProfileFields });
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
