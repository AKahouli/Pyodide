import { Prop, Schema } from '@nestjs/mongoose';

@Schema({ _id: false })
export class ControlEdge {
  @Prop({ required: true, type: String })
  id!: string;

  @Prop({ required: true, type: String, enum: ['sequential', 'conditional'] })
  kind!: string;

  @Prop({ required: true, type: String })
  source!: string;

  @Prop({ required: true, type: String })
  target!: string;

  @Prop({ required: false, type: String })
  routerLabel?: string;

  @Prop({ required: false, type: String })
  sourceOutputPortId?: string;

  @Prop({ required: false, type: String })
  targetInputPortId?: string;

  @Prop({ required: false, type: Number, default: 0 })
  priority?: number;
}

@Schema({ _id: false })
export class DataBinding {
  @Prop({ required: true, type: String })
  id!: string;

  @Prop({ required: true, type: String })
  targetNode!: string;

  @Prop({ required: true, type: String })
  targetPort!: string;

  @Prop({ required: true, type: String, enum: ['node-output', 'trigger', 'state', 'constant', 'expression'] })
  sourceKind!: string;

  @Prop({ required: false, type: String })
  sourceNode?: string;

  @Prop({ required: false, type: String })
  sourcePort?: string;

  @Prop({ required: false, type: String, enum: ['current', 'previous'], default: 'current' })
  iteration?: string;

  @Prop({ required: false, type: String })
  triggerPath?: string;

  @Prop({ required: false, type: String })
  statePath?: string;

  @Prop({ required: false, type: Object })
  constantValue?: unknown;

  @Prop({ required: false, type: String })
  expression?: string;
}
