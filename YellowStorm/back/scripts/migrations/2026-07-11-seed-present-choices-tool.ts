/* eslint-disable no-console */
/** Idempotently registers the native conversational choice tool for admin assignment. */
import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';

async function main(): Promise<void> {
  loadEnv();
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const now = new Date();
    const category = await db.collection('tool_categories').findOneAndUpdate(
      { name: 'Conversational UI' },
      { $setOnInsert: { name: 'Conversational UI', description: 'Native tools that render conversational UI components.', createdAt: now }, $set: { updatedAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    await db.collection('tools').updateOne(
      { name: 'present_choices' },
      {
        $set: {
          description: `Present a structured question, action, or suggestion with selectable answers.

Use this tool whenever the next response depends on the user selecting an intent, category, action, or confirmation. Do not use it for informational lists or when an open-ended response is sufficient.

Choose presentation deliberately:
- quick_replies: two to five short, mutually exclusive answers that can be submitted immediately. Use for simple routing, yes/no, or a next action with no explanation needed.
- list: use whenever an option needs a description, the user can choose multiple answers, an Other/custom answer is allowed, or the user must review and explicitly confirm before submitting. Multiple selection and custom answers always require explicit submission.

The component renders its own prompt, introduction, and options. When calling this tool, do not repeat the question, options, or a related introduction in conversational text. Do not emit bullets, numbered lists, dashes, or instructions to type an answer. Make the tool call without prose unless unrelated conversational context is essential.

Ground every option in the conversation. Give each option a stable id, concise visible label, and autonomous submitText that the agent can understand without the UI. An option may include an absolute HTTPS url when opening an external page is useful; it is rendered as a separate link and never replaces choice submission. Never use JavaScript, data URLs, HTTP URLs, or arbitrary executable actions.`,
          categoryId: category?._id ?? null,
          requiredAppKey: null,
          defaultAgentTypes: [],
          attributes: [],
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: { name: 'present_choices', createdAt: now },
      },
      { upsert: true },
    );
    console.log('Seeded present_choices under Conversational UI.');
  } finally { await client.close(); }
}

main().catch((error) => { console.error(error); process.exit(1); });
