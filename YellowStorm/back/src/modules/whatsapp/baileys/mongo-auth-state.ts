import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { loadBaileys } from './baileys-loader';
import {
  WhatsAppAuthSession,
  WhatsAppAuthSessionDocument,
} from '../schemas/whatsapp-auth-session.schema';

type KeyFileMap = Record<string, unknown>;

@Injectable()
export class MongoBaileysAuthStore {
  constructor(
    @InjectModel(WhatsAppAuthSession.name)
    private readonly authSessionModel: Model<WhatsAppAuthSessionDocument>,
    private readonly cryptoService: CryptoService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(MongoBaileysAuthStore.name);
  }

  async createAuthState(integrationId: Types.ObjectId): Promise<{
    state: import('@whiskeysockets/baileys').AuthenticationState;
    saveCreds: () => Promise<void>;
  }> {
    const baileys = await loadBaileys();
    const keyFiles: KeyFileMap = {};
    const existing = await this.authSessionModel.findOne({ integrationId }).exec();

    let creds = baileys.initAuthCreds();
    if (existing?.encryptedCredentials) {
      try {
        creds = JSON.parse(
          this.cryptoService.decrypt(existing.encryptedCredentials),
          baileys.BufferJSON.reviver,
        );
      } catch (error) {
        this.logger.warn('Failed to decrypt WhatsApp credentials; starting fresh', {
          integrationId: integrationId.toString(),
          error: (error as Error).message,
        });
      }
    }
    if (existing?.encryptedKeys) {
      try {
        // Signal keys (sessions, sender-keys, pre-keys) contain Buffers. They
        // MUST be revived with Baileys' BufferJSON.reviver or they come back as
        // plain `{type:'Buffer',data:[...]}` objects, corrupting decryption
        // (Bad MAC / "serialized is not iterable") after a process restart.
        const parsed = JSON.parse(
          this.cryptoService.decrypt(existing.encryptedKeys),
          baileys.BufferJSON.reviver,
        );
        Object.assign(keyFiles, parsed);
      } catch (error) {
        this.logger.warn('Failed to decrypt WhatsApp keys; starting fresh keys', {
          integrationId: integrationId.toString(),
          error: (error as Error).message,
        });
      }
    }

    const persistKeys = async () => {
      // Use BufferJSON.replacer so Buffers survive the round-trip to MongoDB.
      const encryptedKeys = this.cryptoService.encrypt(
        JSON.stringify(keyFiles, baileys.BufferJSON.replacer),
      );
      await this.authSessionModel.findOneAndUpdate(
        { integrationId },
        { $set: { encryptedKeys } },
        { upsert: true, new: true },
      );
    };

    const saveCreds = async () => {
      const encryptedCredentials = this.cryptoService.encrypt(
        JSON.stringify(creds, baileys.BufferJSON.replacer),
      );
      await this.authSessionModel.findOneAndUpdate(
        { integrationId },
        { $set: { encryptedCredentials } },
        { upsert: true, new: true },
      );
    };

    const keys = {
      get: async (type: string, ids: string[]) => {
        const data: Record<string, unknown> = {};
        await Promise.all(
          ids.map(async (id) => {
            data[id] = keyFiles[`${type}-${id}`] ?? null;
          }),
        );
        return data;
      },
      set: async (data: Record<string, Record<string, unknown>>) => {
        for (const category of Object.keys(data)) {
          const bucket = data[category];
          for (const id of Object.keys(bucket)) {
            const fileKey = `${category}-${id}`;
            const value = bucket[id];
            if (value) {
              keyFiles[fileKey] = value;
            } else {
              delete keyFiles[fileKey];
            }
          }
        }
        await persistKeys();
      },
    };

    const state = {
      creds,
      keys,
    } as import('@whiskeysockets/baileys').AuthenticationState;

    return { state, saveCreds };
  }

  async deleteAuthState(integrationId: Types.ObjectId): Promise<void> {
    await this.authSessionModel.deleteOne({ integrationId }).exec();
  }
}
