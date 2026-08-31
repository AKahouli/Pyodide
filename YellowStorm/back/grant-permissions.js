const mongoose = require('mongoose');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');

mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 }).then(async () => {
  const db = mongoose.connection.db;
  const result = await db.collection('users').updateOne(
    { email: 'test@example.com' },
    { $set: { permissions: ['playbook.*'], roles: [] } }
  );
  console.log('Modified:', result.modifiedCount);
  await mongoose.disconnect();
}).catch(err => console.error(err.message));
