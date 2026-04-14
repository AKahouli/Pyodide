const mongoose = require('mongoose');
const Schema = mongoose.Schema;

async function checkEval() {
  try {
    const evalSchema = new Schema({ scenarioName: String, status: String, results: Array }, { collection: 'evaluations', strict: false });
    await mongoose.connect('mongodb://localhost:27017/yellostorm');
    const Eval = mongoose.model('Evaluation', evalSchema);
    const e = await Eval.findOne({ scenarioName: 'test990' }).sort({ createdAt: -1 });
    console.log('--- EVAL STATUS ---');
    console.log(JSON.stringify(e, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkEval();
