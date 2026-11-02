import { Module } from '@nestjs/common';
import { env } from '../env.js';
import { AzureBlobStorage } from './azure-blob-storage.js';
import { FILE_STORAGE, type FileStorage } from './file-storage.js';
import { LocalDiskStorage } from './local-disk-storage.js';

@Module({
  providers: [
    {
      provide: FILE_STORAGE,
      useFactory: (): FileStorage =>
        env.azureStorage.connectionString
          ? AzureBlobStorage.fromConnectionString(
              env.azureStorage.connectionString,
              env.azureStorage.container,
            )
          : new LocalDiskStorage(env.uploadDir),
    },
  ],
  exports: [FILE_STORAGE],
})
export class FileStorageModule {}
