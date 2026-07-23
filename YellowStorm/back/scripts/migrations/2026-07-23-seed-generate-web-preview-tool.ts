/* eslint-disable no-console */
/** Idempotently registers HTML preview generation for explicit agent assignment. */
import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';

const usagePrompt = `

<web_preview_tool>
Use generate_web_preview when an interactive or visual HTML presentation materially improves the answer. Give it a precise request containing the content, data, layout, and interactions to render. The tool displays its result automatically, so do not paste the generated HTML into conversational text. Continue with a concise normal response after the tool call.
</web_preview_tool>`;

const generatorInstructions = `Generate a complete, self-contained HTML document for the requested preview.

Return only HTML, without Markdown fences or explanatory text. Include all CSS and JavaScript inline. Do not use external scripts, stylesheets, fonts, images, network requests, forms, popups, or top-level navigation. Make the result responsive and accessible, and use the supplied conversation context and data exactly.`;

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
      { name: 'generate_web_preview' },
      {
        $set: {
          description: 'Generate and automatically render a self-contained interactive HTML preview when a visual response is useful.',
          categoryId: category?._id ?? null,
          requiredAppKey: null,
          defaultAgentTypes: [],
          attributes: [
            { name: 'prompt', type: 'string', value: usagePrompt },
            { name: 'instructions', type: 'string', value: generatorInstructions },
          ],
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: { name: 'generate_web_preview', createdAt: now },
      },
      { upsert: true },
    );
    console.log('Seeded generate_web_preview under Conversational UI.');
  } finally { await client.close(); }
}

main().catch((error) => { console.error(error); process.exit(1); });
