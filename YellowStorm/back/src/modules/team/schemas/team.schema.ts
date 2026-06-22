import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type TeamDocument = HydratedDocument<Team>;

/**
 * A team member: an agent in the team plus its position in the org-chart
 * hierarchy. `parentAgentId` is null for root nodes. `order` sorts siblings;
 * `positionX/Y` persist the node's canvas coordinates.
 */
@Schema({ _id: false })
export class TeamMember {
  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true })
  agentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Agent', default: null })
  parentAgentId!: Types.ObjectId | null;

  @Prop({ default: 0, min: 0 })
  order!: number;

  @Prop({ default: 0 })
  positionX!: number;

  @Prop({ default: 0 })
  positionY!: number;
}

export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember);

/**
 * A Team is a named group of agents owned by a user, organised as a hierarchy
 * (org-chart). Two uses:
 *  - conversation mentions: `@MyTeam` expands into the team's agents at send
 *    time (see `TeamService.resolveAgentIds`);
 *  - org-chart: the `members` hierarchy can be edited and persisted.
 */
@Schema({
  timestamps: true,
  collection: 'teams',
})
export class Team extends Document {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 100 })
  name!: string;

  @Prop({ default: '', maxlength: 2000 })
  description!: string;

  /** Agents that belong to the team, with their hierarchy/position metadata. */
  @Prop({ type: [TeamMemberSchema], default: [] })
  members!: TeamMember[];

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TeamSchema = SchemaFactory.createForClass(Team);

// Indexes
TeamSchema.index({ createdBy: 1, isActive: 1 });
TeamSchema.index({ name: 1, createdBy: 1 }, { unique: true });
TeamSchema.index({ 'members.agentId': 1 });

// JSON transform
TeamSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
