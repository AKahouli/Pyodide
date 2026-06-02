/* eslint-disable no-console */

/**

* One-shot migration: drop the legacy `sessionId_1` unique index from the

* `conversation_v2_sessions` collection.

*

* Background: V2 used to store the AI service's UUID in a `sessionId` field

* with a `unique: true` index. The ObjectId migration renamed the field to

* `aiSessionId` and dropped the `@Prop` from the schema, but Mongoose does

* NOT drop the existing index on the live collection — that lives in MongoDB

* metadata, independent of the model. As a result every new insert (which

* has no `sessionId` field at all) is treated by the unique index as

* `sessionId: null`, and the second insert collides with the first.

*

* Usage:

*   cd back && npx ts-node scripts/migrations/2026-05-25-drop-conversation-v2-sessionid-index.ts

*

* Safe to run multiple times — the catch block ignores "index not found".

*/

import { config as loadEnv } from 'dotenv';

import { MongoClient } from 'mongodb';



async function main(): Promise<void> {

  loadEnv();

  const uri ="mongodb://root:47U9QDO7R0jq@142.132.131.111:3506/poc-aga-005?authSource=admin"
;

  if (!uri) {

    throw new Error('MONGODB_URI not set in .env');

  }

  const client = new MongoClient(uri);

  await client.connect();



  try {

    const db = client.db();

    const col = db.collection('conversation_v2_sessions');

    try {

      await col.dropIndex('sessionId_1');

      console.log("Dropped legacy index 'sessionId_1' from conversation_v2_sessions");

    } catch (err) {

      const msg = (err as Error).message;

      if (msg.includes('index not found') || msg.includes('IndexNotFound')) {

        console.log("Index 'sessionId_1' not present — already dropped or never existed");

      } else {

        throw err;

      }

    }

  } finally {

    await client.close();

  }

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});

 