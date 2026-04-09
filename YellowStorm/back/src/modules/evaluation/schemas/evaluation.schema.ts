import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type EvaluationDocument = HydratedDocument<Evaluation>;

@Schema({ _id: false })
class MetricResult {
    @Prop({ default: 0 })
    score!: number;

    @Prop({ default: '' })
    reasoning?: string;
}

@Schema({ _id: false })
class EvaluationIteration {
    @Prop({ required: true })
    iterationIndex!: number;

    @Prop({ default: '' })
    question?: string;

    @Prop({ default: '' })
    agentAnswer?: string;

    @Prop({ default: '' })
    referenceAnswer?: string;

    @Prop({ type: MetricResult })
    responseMatchScore!: MetricResult;

    @Prop({ type: MetricResult })
    finalResponseMatchV2!: MetricResult;

    @Prop({ type: MetricResult })
    hallucinationsV1!: MetricResult;

    @Prop({ required: true })
    timestamp!: string;
}

@Schema({
    timestamps: true,
    collection: 'evaluations',
})
export class Evaluation extends Document {
    @Prop({ type: Types.ObjectId, ref: 'Agent', required: true, index: true })
    agentId!: Types.ObjectId;

    @Prop({ required: true, trim: true })
    scenarioName!: string;

    @Prop({ required: true, enum: ['strict', 'non_strict'], default: 'non_strict' })
    mode!: string;

    @Prop({ type: [EvaluationIteration], default: [] })
    results!: EvaluationIteration[];

    @Prop({ required: true, enum: ['processing', 'completed', 'failed'], default: 'processing' })
    status!: string;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
    createdBy!: Types.ObjectId;

    @Prop()
    error?: string;

    createdAt!: Date;
    updatedAt!: Date;
}

export const EvaluationSchema = SchemaFactory.createForClass(Evaluation);

// JSON transform
EvaluationSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
    },
});
