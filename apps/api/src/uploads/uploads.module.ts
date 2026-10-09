import { Module } from '@nestjs/common';
import { UploadsService } from './uploads.service.js';

@Module({
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
