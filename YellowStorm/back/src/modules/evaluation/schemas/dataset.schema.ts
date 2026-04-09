import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type DatasetDocument = HydratedDocument<Dataset>;

@Schema({ _id: false })
export class DatasetItem {
    @Prop({ required: true, trim: true })
    question!: string;

    @Prop({ required: true, trim: true })
    reference_answer!: string;
}

@Schema({
    timestamps: true,
    collection: 'datasets',
})
export class Dataset extends Document {
    @Prop({ required: true, trim: true })
    name!: string;

    @Prop({ type: [DatasetItem], default: [] })
    items!: DatasetItem[];

    @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
    createdBy!: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Workspace', index: true })
    workspaceId?: Types.ObjectId;

    createdAt!: Date;
    updatedAt!: Date;
}

export const DatasetSchema = SchemaFactory.createForClass(Dataset);

// JSON transform
DatasetSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
    },
});
