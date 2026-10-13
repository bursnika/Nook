import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { FeatureGuard } from './feature.guard.js';
import { FeaturesController } from './features.controller.js';
import { FeaturesService } from './features.service.js';

@Module({
  imports: [WorkspacesModule],
  controllers: [FeaturesController],
  providers: [FeaturesService, FeatureGuard, { provide: APP_GUARD, useExisting: FeatureGuard }],
  exports: [FeaturesService],
})
export class FeaturesModule {}
