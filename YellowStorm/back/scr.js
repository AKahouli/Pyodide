"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const mongodb_1 = require("mongodb");
async function main() {
    (0, dotenv_1.config)();
    const uri = "mongodb://root:47U9QDO7R0jq@142.132.131.111:3506/poc-aga-005?authSource=admin";
    if (!uri) {
        throw new Error('MONGODB_URI not set in .env');
    }
    const client = new mongodb_1.MongoClient(uri);
    await client.connect();
    try {
        const db = client.db();
        const col = db.collection('conversation_v2_sessions');
        try {
            await col.dropIndex('sessionId_1');
            console.log("Dropped legacy index 'sessionId_1' from conversation_v2_sessions");
        }
        catch (err) {
            const msg = err.message;
            if (msg.includes('index not found') || msg.includes('IndexNotFound')) {
                console.log("Index 'sessionId_1' not present — already dropped or never existed");
            }
            else {
                throw err;
            }
        }
    }
    finally {
        await client.close();
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=scr.js.map