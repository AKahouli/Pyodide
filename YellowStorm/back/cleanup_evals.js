const mongoose = require('mongoose');
const { Schema } = mongoose;
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

async function cleanup() {
    try {
        if (!MONGODB_URI) throw new Error('MONGODB_URI is required');
        console.log('Connecting to remote MongoDB...');
        await mongoose.connect(MONGODB_URI);
        const Evaluation = mongoose.model('Evaluation', new Schema({}, { strict: false }));
        const res = await Evaluation.updateMany(
            { status: 'processing' }, 
            { status: 'failed', error: 'System stabilization reset' }
        );
        console.log(`Successfully cleaned up ${res.modifiedCount} stale evaluations.`);
        process.exit(0);
    } catch (e) {
        console.error('Cleanup failed:', e);
        process.exit(1);
    }
}

cleanup();
