import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type ScenarioDocument = Scenario & Document;

@Schema({ timestamps: true })
export class Scenario {
    @Prop({ required: true })
    name!: string;

    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Agent', required: true })
    agentId!: MongooseSchema.Types.ObjectId;

    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Dataset', required: true })
    datasetId?: MongooseSchema.Types.ObjectId;

    @Prop({ default: 1 })
    numRuns!: number;

    @Prop({ default: 'non_strict' })
    mode!: string;
}

export const ScenarioSchema = SchemaFactory.createForClass(Scenario);
