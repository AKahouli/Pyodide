import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../../config/storage.config';
import { DocumentService } from './document.service';
import { DocumentConnectionService } from './document-connection.service';
import { DocumentController } from './document.controller';

@Global()
@Module({
  imports: [ConfigModule.forFeature(storageConfig)],
  controllers: [DocumentController],
  providers: [DocumentConnectionService, DocumentService],
  exports: [DocumentService, DocumentConnectionService],
})
export class DocumentModule {}
