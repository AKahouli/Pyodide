const mongoose = require('mongoose');
const { Schema } = mongoose;

const MONGODB_URI = "mongodb://root:47U9QDO7R0jq@173.208.208.93:3006/yellowstorm?authSource=admin";

async function cleanup() {
    try {
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
