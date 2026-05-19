import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';

dotenv.config();

const mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/yellowstorm';
const encryptionKey = process.env.ENCRYPTION_KEY || crypto.createHash('sha256').update('yellostorm-dev-encryption-key').digest().toString('hex');
const key = Buffer.from(encryptionKey, 'hex');

const connectedAppDefinitionSchema = new mongoose.Schema({
  appKey: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  displayName: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  iconKey: { type: String, trim: true },
  authorizationUrl: { type: String, required: true },
  tokenUrl: { type: String, required: true },
  revokeUrl: { type: String },
  clientId: { type: String, required: true },
  clientSecret: { type: String, required: true },
  tenantId: { type: String },
  scopes: { type: [String], required: true },
  pkceEnabled: { type: Boolean, default: true },
  enabled: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

connectedAppDefinitionSchema.index({ enabled: 1, sortOrder: 1 });
connectedAppDefinitionSchema.index({ appKey: 1 }, { unique: true });

const ConnectedAppDefinition = mongoose.model('ConnectedAppDefinition', connectedAppDefinitionSchema, 'connected_app_definitions');

function encrypt(plaintext: string): string {
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  const payload = {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted,
  };

  return JSON.stringify(payload);
}

async function seedGithubApp(): Promise<void> {
  console.log('Checking for existing GitHub connected app...');

  const existing = await ConnectedAppDefinition.findOne({ appKey: 'github' });

  const githubAppData = {
    appKey: 'github',
    displayName: 'GitHub',
    description: 'GitHub connector for MCP integration',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org'],
    clientId: encrypt(process.env.GITHUB_CLIENT_ID || ''),
    clientSecret: encrypt(process.env.GITHUB_CLIENT_SECRET || ''),
    pkceEnabled: false,
    enabled: true,
    sortOrder: 1,
  };

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    console.warn('Warning: GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set in .env. Using empty values.');
  }

  if (existing) {
    console.log('GitHub connected app already exists, updating...');
    await ConnectedAppDefinition.updateOne({ appKey: 'github' }, githubAppData);
    console.log('GitHub connected app updated successfully');
  } else {
    console.log('Creating GitHub connected app...');
    await ConnectedAppDefinition.create(githubAppData);
    console.log('GitHub connected app created successfully');
  }
}

async function main(): Promise<void> {
  console.log('Starting GitHub connected app seed...');
  console.log(`Connecting to MongoDB: ${mongodbUri.replace(/:[^:@]+(?=@)/, ':****')}`);

  await mongoose.connect(mongodbUri);
  console.log('Connected to MongoDB successfully');

  try {
    await seedGithubApp();
    console.log('Seed completed successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

main().catch((error) => {
  console.error('Bootstrap error:', error);
  process.exit(1);
});