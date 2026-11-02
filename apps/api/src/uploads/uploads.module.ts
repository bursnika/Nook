import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { storageOptions } from '../attachments/upload.config.js';
import { FILE_STORAGE, type FileStorage } from './file-storage.js';
import { FileStorageModule } from './file-storage.module.js';
import { UploadsService } from './uploads.service.js';

@Module({
  imports: [
    FileStorageModule,
    MulterModule.registerAsync({
      imports: [FileStorageModule],
      inject: [FILE_STORAGE],
      useFactory: (storage: FileStorage) => storageOptions(storage),
    }),
  ],
  providers: [UploadsService],
  exports: [UploadsService, FileStorageModule, MulterModule],
})
export class UploadsModule {}
