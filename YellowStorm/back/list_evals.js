const mongoose = require('mongoose');
const Schema = mongoose.Schema;
require('dotenv').config();

async function listEvals() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is required');
    const evalSchema = new Schema({ scenarioName: String, status: String, results: Array, createdAt: Date }, { collection: 'evaluations', strict: false });
    console.log('Connecting to remote DB...');
    await mongoose.connect(uri);
    const Eval = mongoose.model('Evaluation', evalSchema);
    const evals = await Eval.find().sort({ createdAt: -1 }).limit(10);
    console.log('--- RECENT EVALS ---');
    evals.forEach(e => {
        console.log(`- ID: ${e._id}, Name: "${e.scenarioName}", Status: ${e.status}, Date: ${e.createdAt}`);
    });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

listEvals();
