const mongoose = require('mongoose');
mongoose.connect('mongodb://root:47U9QDO7R0jq@142.132.131.111:3506/poc?authSource=admin', { serverSelectionTimeoutMS: 5000 }).then(async () => {
  const db = mongoose.connection.db;
  const result = await db.collection('users').updateOne(
    { email: 'test@example.com' },
    { $set: { permissions: ['playbook.*'], roles: [] } }
  );
  console.log('Modified:', result.modifiedCount);
  await mongoose.disconnect();
}).catch(err => console.error(err.message));
