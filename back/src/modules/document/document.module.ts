import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../../config/storage.config';
import { DocumentService } from './document.service';
import { DocumentConnectionService } from './document-connection.service';

@Global()
@Module({
  imports: [ConfigModule.forFeature(storageConfig)],
  providers: [DocumentConnectionService, DocumentService],
  exports: [DocumentService, DocumentConnectionService],
})
export class DocumentModule {}
